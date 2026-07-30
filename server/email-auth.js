const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RESEND_INTERVAL_MS = 60 * 1000;
const DEFAULT_HOURLY_SEND_LIMIT = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const pendingCodes = new Map();
const sendHistory = new Map();

function envValue(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function numericEnv(name, fallback, minimum = 0) {
  const raw = envValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function configuredSmtp() {
  const host = envValue("SMTP_HOST");
  const port = Math.max(1, Math.floor(numericEnv("SMTP_PORT", 465, 1)));
  const user = envValue("SMTP_USER");
  const pass = envValue("SMTP_PASS");
  const from = envValue("SMTP_FROM", user);
  return {
    host,
    port,
    secure: !/^(0|false|no)$/i.test(envValue("SMTP_SECURE", port === 465 ? "true" : "false")),
    user,
    pass,
    from,
    configured: !!(host && user && pass && from),
  };
}

function codeSecret() {
  return envValue("PIXEL_TOYS_EMAIL_CODE_SECRET") || envValue("PIXEL_TOYS_AUTH_SECRET");
}

function codeDigest(email, purpose, code) {
  const secret = codeSecret();
  if (!secret) throw smtpError("邮箱验证码服务未配置密钥，请联系管理员", 503);
  return crypto.createHmac("sha256", secret).update(`${purpose}:${email}:${code}`).digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function smtpError(message, code = 502) {
  const error = new Error(message);
  error.statusCode = code;
  return error;
}

function smtpSend({ to, subject, text, html } = {}) {
  const config = configuredSmtp();
  if (!config.configured) throw smtpError("邮箱验证码服务未配置 SMTP，请联系管理员", 503);

  const timeoutMs = Math.max(5_000, Math.floor(numericEnv("SMTP_TIMEOUT_MS", 20_000, 1)));
  const transport = config.secure ? tls : net;
  const options = config.secure
    ? { host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true }
    : { host: config.host, port: config.port };

  return new Promise((resolve, reject) => {
    const socket = transport.connect(options);
    let buffer = "";
    let settled = false;
    let timer = null;
    const queue = [];
    let awaiting = null;
    let greetingReceived = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    const armTimeout = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(smtpError("邮件服务连接超时", 504)), timeoutMs);
    };

    const send = (command) => {
      if (!settled) {
        socket.write(`${command}\r\n`);
        armTimeout();
      }
    };

    const next = () => {
      if (settled || !greetingReceived || awaiting || queue.length === 0) return;
      awaiting = queue.shift();
      send(awaiting.command);
    };

    const expect = (command, accepted, onSuccess) => {
      queue.push({ command, accepted, onSuccess });
      next();
    };

    const fail = (message, statusCode = 502) => finish(smtpError(message, statusCode));

    const handleResponse = (line) => {
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) return;
      const code = Number(match[1]);
      if (match[2] === "-") return;
      if (!greetingReceived) {
        if (code !== 220) return fail("邮件服务返回错误 " + code + ": " + match[3]);
        greetingReceived = true;
        return next();
      }
      const step = awaiting;
      awaiting = null;
      if (!step) return;
      if (!step.accepted.includes(code)) return fail(`邮件服务返回错误 ${code}: ${match[3]}`);
      try {
        step.onSuccess();
      } catch (error) {
        return fail(error.message || "邮件发送失败");
      }
      next();
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) handleResponse(line);
    });
    socket.on("error", (error) => fail(`邮件服务连接失败: ${error.message}`));
    socket.on("close", () => {
      if (!settled) fail("邮件服务连接已关闭");
    });
    socket.on(config.secure ? "secureConnect" : "connect", () => armTimeout());

    const message = [
      `From: Pixel Toys <${config.from}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="pixel-toys-boundary"',
      "",
      "--pixel-toys-boundary",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      "",
      "--pixel-toys-boundary",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "",
      "--pixel-toys-boundary--",
    ].join("\r\n").replace(/^\./gm, "..");

    expect("EHLO pixeltoy.cn", [250], () => expect("AUTH LOGIN", [334], () => {
      expect(Buffer.from(config.user).toString("base64"), [334], () => {
        expect(Buffer.from(config.pass).toString("base64"), [235], () => {
          expect(`MAIL FROM:<${config.from}>`, [250], () => {
            expect(`RCPT TO:<${to}>`, [250, 251], () => {
              expect("DATA", [354], () => {
                expect(`${message}\r\n.`, [250], () => {
                  expect("QUIT", [221, 250], () => finish());
                });
              });
            });
          });
        });
      });
    }));
  });
}

function rateKeyFor(email, key = "") {
  return `${String(key || "anonymous").slice(0, 120)}:${email}`;
}

async function requestEmailCode({ email: rawEmail, purpose = "register", rateKey = "" } = {}) {
  const email = normalizeEmail(rawEmail);
  const cleanPurpose = purpose === "login" ? "login" : "register";
  if (!isValidEmail(email)) throw smtpError("请输入有效的邮箱地址", 400);
  const now = Date.now();
  const key = rateKeyFor(email, rateKey);
  const existing = pendingCodes.get(`${cleanPurpose}:${email}`);
  const resendInterval = numericEnv("PIXEL_TOYS_EMAIL_CODE_RESEND_MS", DEFAULT_RESEND_INTERVAL_MS, 0);
  if (existing && now - existing.sentAt < resendInterval) {
    throw smtpError(`验证码已发送，请 ${Math.ceil((resendInterval - now + existing.sentAt) / 1000)} 秒后重试`, 429);
  }
  const history = (sendHistory.get(key) || []).filter((timestamp) => now - timestamp < 60 * 60 * 1000);
  if (history.length >= numericEnv("PIXEL_TOYS_EMAIL_CODE_HOURLY_LIMIT", DEFAULT_HOURLY_SEND_LIMIT, 1)) {
    throw smtpError("验证码发送次数过多，请稍后再试", 429);
  }
  const code = generateCode();
  const digest = codeDigest(email, cleanPurpose, code);
  const expiresAt = now + numericEnv("PIXEL_TOYS_EMAIL_CODE_TTL_MS", DEFAULT_CODE_TTL_MS, 60_000);
  pendingCodes.set(`${cleanPurpose}:${email}`, { digest, expiresAt, sentAt: now, attempts: 0 });
  sendHistory.set(key, [...history, now]);
  const text = `你的 Pixel Toys 验证码是 ${code}，${Math.round((expiresAt - now) / 60_000)} 分钟内有效。如非本人操作，请忽略此邮件。`;
  const html = `<div style="font-family:Arial,sans-serif;color:#172016"><p>你的 Pixel Toys 验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>验证码 ${Math.round((expiresAt - now) / 60_000)} 分钟内有效。如非本人操作，请忽略此邮件。</p></div>`;
  try {
    await smtpSend({ to: email, subject: "Pixel Toys 邮箱验证码", text, html });
  } catch (error) {
    pendingCodes.delete(`${cleanPurpose}:${email}`);
    throw error;
  }
  return { expiresInSeconds: Math.round((expiresAt - now) / 1000) };
}

function verifyEmailCode({ email: rawEmail, purpose = "register", code = "" } = {}) {
  const email = normalizeEmail(rawEmail);
  const cleanPurpose = purpose === "login" ? "login" : "register";
  const entryKey = `${cleanPurpose}:${email}`;
  const entry = pendingCodes.get(entryKey);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingCodes.delete(entryKey);
    throw smtpError("验证码无效或已过期", 400);
  }
  entry.attempts += 1;
  if (entry.attempts > numericEnv("PIXEL_TOYS_EMAIL_CODE_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1)) {
    pendingCodes.delete(entryKey);
    throw smtpError("验证码尝试次数过多，请重新获取", 400);
  }
  const candidate = String(code || "").trim();
  if (!/^\d{6}$/.test(candidate) || codeDigest(email, cleanPurpose, candidate) !== entry.digest) {
    throw smtpError("验证码不正确", 400);
  }
  pendingCodes.delete(entryKey);
  return true;
}

module.exports = {
  configuredSmtp,
  isValidEmail,
  normalizeEmail,
  requestEmailCode,
  verifyEmailCode,
};
