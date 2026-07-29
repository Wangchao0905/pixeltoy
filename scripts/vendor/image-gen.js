#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const { access, mkdir, readFile, writeFile } = require("node:fs/promises");
const dns = require("node:dns");
const path = require("node:path");

// Some production hosts have an unreachable IPv6 route while the gateway is
// reachable over IPv4. Node's default resolver may choose IPv6 first, causing
// the generation child process to time out before the provider sees a request.
dns.setDefaultResultOrder("ipv4first");

class UserError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const equalAt = item.indexOf("=");
    if (equalAt > 2) {
      args[item.slice(2, equalAt)] = item.slice(equalAt + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = "true";
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "用法：node scripts/node/image-gen.js --mode text|image|edit --prompt <提示词> [参数]",
    "",
    "通用参数：",
    "  --api-key <key>       默认读取 OPENAI_API_KEY",
    "  --base-url <url>      默认 https://api.apikey.fun/v1，兼容不带 /v1",
    "  --mode <mode>         text=文生图，image=文+图生图，edit=图片编辑",
    "  --prompt <text>       提示词",
    "  --image <path|url>    image/edit 模式必填，支持本地图片或 http(s) URL",
    "  --n <number>          生成数量，默认 1",
    "  --out <path|dir>      保存位置，默认 generated-image.png 或 edited-image.png",
    "  --size <size>         默认 1024x1024，可用 3840x2160、2160x3840 等",
    "  --model <model>       text/edit 默认 gpt-image-2；image 模式默认 gpt-5.4-mini",
    "  --image-model <model> image 模式图片工具模型，默认 gpt-image-2",
    "  --quality <quality>   默认 auto",
    "  --timeout <seconds>   默认 900",
  ].join("\n");
}

function requireArg(args, key, fallback = "") {
  const value = args[key] || fallback;
  if (!value) throw new UserError("missing_argument", `缺少必填参数 --${key}`, { key, usage: usage() });
  return value;
}

function intArg(args, key, fallback) {
  const value = Number.parseInt(args[key] || String(fallback), 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new UserError("invalid_argument", `--${key} 必须是正整数`, { key, value: args[key] });
  }
  return value;
}

function normalizeMode(mode) {
  const value = (mode || "text").toLowerCase();
  if (!["text", "image", "edit"].includes(value)) {
    throw new UserError("invalid_mode", "--mode 只能是 text、image 或 edit", { mode });
  }
  return value;
}

function buildApiUrl(baseUrl, pathWithV1) {
  const base = (baseUrl || "https://api.apikey.fun/v1").replace(/\/+$/, "");
  const apiPath = pathWithV1.startsWith("/") ? pathWithV1 : `/${pathWithV1}`;
  if (base.endsWith("/v1") && apiPath.startsWith("/v1/")) return `${base}${apiPath.slice(3)}`;
  return `${base}${apiPath}`;
}

function contentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function assertLocalImageReadable(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new UserError("image_path_not_found", "本地图片路径不存在或不可读取", { image: filePath });
  }
}

async function fetchImageUrl(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new UserError("image_url_fetch_failed", "图片链接无法打开", { image: url, reason: error.message });
  }
  if (!response.ok) {
    throw new UserError("image_url_http_error", "图片链接返回非成功状态码", {
      image: url,
      status: response.status,
      body: await response.text().catch(() => ""),
    });
  }
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new UserError("image_url_not_image", "图片链接返回的内容不是图片", { image: url, contentType });
  }
  return { bytes: await response.arrayBuffer(), contentType, name: path.basename(new URL(url).pathname) || "source.png" };
}

async function imageToInputUrl(image) {
  if (/^https?:\/\//i.test(image)) {
    // api.apikey.fun can fetch a public reference URL, but its Responses
    // gateway times out when the same image is embedded as a data URL.
    return image;
  }
  if (/^data:/i.test(image)) return image;
  await assertLocalImageReadable(image);
  const bytes = await readFile(image);
  return `data:${contentTypeFromPath(image)};base64,${bytes.toString("base64")}`;
}

async function imageToFormFile(image) {
  if (/^https?:\/\//i.test(image)) {
    const source = await fetchImageUrl(image);
    return { blob: new Blob([source.bytes], { type: source.contentType }), name: source.name };
  }
  await assertLocalImageReadable(image);
  const bytes = await readFile(image);
  return { blob: new Blob([bytes], { type: contentTypeFromPath(image) }), name: path.basename(image) || "source.png" };
}

function timeoutSignal(seconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchWithTimeout(url, options, timeoutSeconds, retries = 2) {
  // 网关(api.apikey.fun)偶发瞬时 fetch failed,单张出图又要几十秒——不重试就直接判失败。
  // 仅对网络失败退避重试;超时(AbortError)已等满,不重试。
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = timeoutSignal(timeoutSeconds);
    try {
      return await fetch(url, { ...options, signal: timeout.signal });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new UserError("request_timeout", "接口请求超时", { timeout: timeoutSeconds, url });
      }
      lastError = error;
    } finally {
      timeout.clear();
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new UserError("network_error", "接口请求网络失败", { url, reason: lastError && lastError.message, attempts: retries + 1 });
}

async function ensureOkResponse(response, url) {
  if (response.ok) return;
  throw new UserError("api_http_error", "生图接口返回非成功状态码", {
    url,
    status: response.status,
    body: await response.text().catch(() => ""),
  });
}

async function* readSseJson(response) {
  if (!response.body) throw new UserError("stream_unreadable", "响应没有可读取的 SSE 流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseFrame = (frame) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return null;
    try {
      return JSON.parse(data);
    } catch (error) {
      throw new UserError("sse_json_parse_error", "SSE data 不是合法 JSON", { data, reason: error.message });
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) yield event;
    }
  }
  // A few gateways close the stream immediately after the final data line
  // without sending the optional blank line that terminates an SSE frame.
  const finalEvent = parseFrame(buffer);
  if (finalEvent) yield finalEvent;
}

function isPartialImageEvent(event) {
  return event?.type === "image_generation.partial_image" ||
    event?.type === "response.image_generation_call.partial_image";
}

function throwIfErrorEvent(event) {
  const response = event?.response && typeof event.response === "object" ? event.response : {};
  const item = event?.item && typeof event.item === "object" ? event.item : {};
  const status = String(response.status || item.status || event?.status || "").toLowerCase();
  const failureStatus = ["failed", "incomplete", "cancelled", "canceled", "refused", "rejected"].includes(status);
  const failureType = ["error", "response.failed", "response.incomplete", "response.cancelled"].includes(event?.type);
  const error = response.error || item.error || event?.error;
  if (!failureType && !failureStatus && !error) return;
  const incomplete = response.incomplete_details || item.incomplete_details || event?.incomplete_details || {};
  const message = error?.message || incomplete.message || incomplete.reason || event?.message || "";
  throw new UserError("api_stream_error", message ? `上游生图错误：${message}` : "生图接口在流式事件中返回错误", {
    type: event.type,
    message,
    status,
    incomplete,
    event,
  });
}

function collectImages(event, images = []) {
  for (const key of ["b64_json", "base64", "image_base64", "partial_image_b64"]) {
    if (typeof event?.[key] === "string" && event[key]) images.push(event[key]);
  }
  if (typeof event?.result === "string" && event.result.length > 100) images.push(event.result);
  for (const key of ["data", "output", "content", "item", "response", "result", "image", "images", "choices", "delta"]) {
    const nested = event?.[key];
    if (Array.isArray(nested)) {
      for (const item of nested) collectImages(item, images);
    } else if (nested && typeof nested === "object") {
      collectImages(nested, images);
    }
  }
  return images;
}

async function readImageResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("json")) {
    const payload = await response.json().catch((error) => {
      throw new UserError("json_parse_error", "图片接口返回的 JSON 无法解析", { reason: error.message });
    });
    throwIfErrorEvent(payload);
    const images = collectImages(payload);
    if (images.length) return { images, partial: false };
    throw new UserError("no_image_result", "接口返回成功，但没有收到图片结果数据", { payload });
  }

  const images = [];
  let lastPartialImages = [];
  for await (const event of readSseJson(response)) {
    throwIfErrorEvent(event);
    const eventImages = collectImages(event);
    if (isPartialImageEvent(event)) {
      if (eventImages.length) lastPartialImages = eventImages;
      continue;
    }
    if (eventImages.length) images.push(...eventImages);
  }
  if (images.length) return { images, partial: false };
  if (lastPartialImages.length) return { images: lastPartialImages, partial: true };
  throw new UserError("no_image_result", "流结束前没有收到图片结果数据");
}

function shouldFallbackToResponses(error) {
  const status = Number(error?.detail?.status || 0);
  const text = `${error?.message || ""} ${error?.detail?.body || ""}`.toLowerCase();
  // The gateway can have capacity for the Responses image tool while its
  // legacy /images/generations account pool is empty. Keep this fallback
  // narrow: a generic 503 should not trigger a second paid request.
  if (status === 503 && /no available (?:compatible )?(?:accounts?|channels?)|no available channel|无可用账号|无可用渠道/.test(text)) return true;
  if (![400, 404, 405, 422, 501].includes(status)) return false;
  return /image|model|stream|response_format|parameter|unsupported|not found|method/.test(text);
}

function outputPathFor(out, index, total, defaultName) {
  const target = out || defaultName;
  const ext = path.extname(target);
  const isDirectory = target.endsWith("/") || target.endsWith("\\") || !ext;
  if (isDirectory) {
    const name = total > 1 ? defaultName.replace(/(\.[^.]+)$/, `-${index + 1}$1`) : defaultName;
    return path.resolve(target, name);
  }
  if (total === 1) return path.resolve(target);
  const dir = path.dirname(target);
  const base = path.basename(target, ext);
  return path.resolve(dir, `${base}-${index + 1}${ext}`);
}

async function saveImages(base64Images, out, defaultName) {
  const paths = [];
  for (let i = 0; i < base64Images.length; i += 1) {
    const filePath = outputPathFor(out, i, base64Images.length, defaultName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(base64Images[i], "base64"));
    paths.push(filePath);
  }
  return paths;
}

async function buildRequest(args, mode) {
  const prompt = requireArg(args, "prompt");
  const n = intArg(args, "n", 1);
  if (mode === "text") {
    return {
      url: buildApiUrl(args["base-url"], "/v1/images/generations"),
      defaultOut: "generated-image.png",
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireArg(args, "api-key", process.env.OPENAI_API_KEY || "")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: args.model || "gpt-image-2",
          prompt,
          n,
          size: args.size || "1024x1024",
          quality: args.quality || "auto",
          stream: false,
          response_format: "b64_json",
        }),
      },
    };
  }

  const image = requireArg(args, "image");
  if (mode === "image") {
    // 主图 + 附加参考图（--reference-image，多张用平台分隔符隔开）全部作为 input_image 传入，
    // gpt-image-2 会直接看到这些像素作为参考。此前只发主图，--reference-image 被静默丢弃。
    const extraReferences = String(args["reference-image"] || "")
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
    const allImages = [image, ...extraReferences];
    const imageContent = await Promise.all(
      allImages.map(async (item) => ({ type: "input_image", image_url: await imageToInputUrl(item) })),
    );
    return {
      url: buildApiUrl(args["base-url"], "/v1/responses"),
      defaultOut: "generated-image.png",
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireArg(args, "api-key", process.env.OPENAI_API_KEY || "")}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: args.model || "gpt-5.4-mini",
          stream: true,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...imageContent,
            ],
          }],
          tools: [{
            type: "image_generation",
            model: args["image-model"] || "gpt-image-2",
            size: args.size || "1024x1024",
            quality: args.quality || "auto",
            output_format: args["output-format"] || "png",
          }],
          tool_choice: { type: "image_generation" },
        }),
      },
    };
  }

  const source = await imageToFormFile(image);
  const form = new FormData();
  form.append("image", source.blob, source.name);
  form.append("prompt", prompt);
  form.append("model", args.model || "gpt-image-2");
  form.append("n", String(n));
  form.append("quality", args.quality || "auto");
  form.append("size", args.size || "1024x1024");
  form.append("stream", "true");
  form.append("response_format", "b64_json");
  return {
    url: buildApiUrl(args["base-url"], "/v1/images/edits"),
    defaultOut: "edited-image.png",
    options: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireArg(args, "api-key", process.env.OPENAI_API_KEY || "")}`,
        Accept: "text/event-stream",
      },
      body: form,
    },
  };
}

function buildTextResponsesRequest(args) {
  const prompt = requireArg(args, "prompt");
  return {
    url: buildApiUrl(args["base-url"], "/v1/responses"),
    options: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireArg(args, "api-key", process.env.OPENAI_API_KEY || "")}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: args["orchestration-model"] || "gpt-5.4-mini",
        stream: true,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        tools: [{
          type: "image_generation",
          model: args.model || "gpt-image-2",
          size: args.size || "1024x1024",
          quality: args.quality || "auto",
          output_format: args["output-format"] || "png",
        }],
        tool_choice: { type: "image_generation" },
      }),
    },
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const mode = normalizeMode(args.mode);
  const n = intArg(args, "n", 1);
  const timeout = intArg(args, "timeout", 900);
  const request = await buildRequest(args, mode);
  let response;
  let usedResponsesFallback = false;
  try {
    response = await fetchWithTimeout(request.url, request.options, timeout);
    await ensureOkResponse(response, request.url);
  } catch (error) {
    if (mode !== "text" || !shouldFallbackToResponses(error)) throw error;
    const fallback = buildTextResponsesRequest(args);
    response = await fetchWithTimeout(fallback.url, fallback.options, timeout);
    await ensureOkResponse(response, fallback.url);
    usedResponsesFallback = true;
  }

  const result = await readImageResponse(response);
  const paths = await saveImages(result.images.slice(0, n), args.out || request.defaultOut, request.defaultOut);
  process.stdout.write(`${JSON.stringify({ ok: true, mode, paths, responsesFallback: usedResponsesFallback, ...(result.partial ? { partial: true } : {}) }, null, 2)}\n`);
}

main().catch((error) => {
  const payload = {
    ok: false,
    code: error.code || "unexpected_error",
    message: error.message || String(error),
    detail: error.detail || {},
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  // Keep a human-readable final line for callers that only retain the tail of stderr.
  process.stderr.write(`${payload.message}\n`);
  process.exitCode = 1;
});
