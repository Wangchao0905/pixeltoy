const { jsonrepair } = require("jsonrepair");

const DEFAULT_BASE_URL = "https://api.apikey.fun/v1";
const GROK_FALLBACK_MODEL = "grok-4.5";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-pro";
// The Gemini model id must be read lazily: server.js loads .env.local only after
// this module is required, so a module-top read would freeze the fallback
// default even when PIXELTALE_GEMINI_MODEL is configured.
function geminiModelId() {
  return (process.env.PIXELTALE_GEMINI_MODEL || GEMINI_FALLBACK_MODEL).trim().toLowerCase();
}
const FALLBACK_BY_SEAT = Object.freeze({
  seat_a: GEMINI_FALLBACK_MODEL,
  seat_b: "claude-sonnet-5",
  seat_c: "claude-haiku-4-5",
});
const REVIEW_SEATS = Object.freeze([
  Object.freeze({ id: "seat_a", role: "structure_causality", model: "gpt-5.6-terra", ownedDimensions: Object.freeze(["structure", "logic"]) }),
  Object.freeze({ id: "seat_b", role: "character_continuity", model: "gpt-5.6-sol", ownedDimensions: Object.freeze(["plot"]) }),
  Object.freeze({ id: "seat_c", role: "audience_pacing_visual", model: "claude-opus-5", ownedDimensions: Object.freeze(["design"]) }),
]);
const REVIEW_DIMENSIONS = Object.freeze(["structure", "plot", "design", "logic"]);

const MODEL_DEFINITIONS = Object.freeze([
  {
    id: "gpt-5.6-terra",
    provider: "chatgpt",
    keyNames: ["PIXELTALE_GPT_API_KEY", "STORYBOARD_API_KEY", "OPENAI_API_KEY"],
    baseNames: ["PIXELTALE_GPT_BASE_URL", "STORYBOARD_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "gpt-5.6-sol",
    provider: "chatgpt",
    keyNames: ["PIXELTALE_GPT_API_KEY", "STORYBOARD_API_KEY", "OPENAI_API_KEY"],
    baseNames: ["PIXELTALE_GPT_BASE_URL", "STORYBOARD_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "gpt-5.6-luna",
    provider: "chatgpt",
    keyNames: ["PIXELTALE_GPT_API_KEY", "STORYBOARD_API_KEY", "OPENAI_API_KEY"],
    baseNames: ["PIXELTALE_GPT_BASE_URL", "STORYBOARD_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "gpt-5.5",
    provider: "chatgpt",
    keyNames: ["PIXELTALE_GPT_API_KEY", "STORYBOARD_API_KEY", "OPENAI_API_KEY"],
    baseNames: ["PIXELTALE_GPT_BASE_URL", "STORYBOARD_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "claude-opus-5",
    provider: "claude",
    keyNames: ["PIXELTALE_CLAUDE_API_KEY", "ASSET_ANALYZER_API_KEY"],
    baseNames: ["PIXELTALE_CLAUDE_BASE_URL", "ASSET_ANALYZER_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "claude-sonnet-5",
    provider: "claude",
    keyNames: ["PIXELTALE_CLAUDE_API_KEY", "ASSET_ANALYZER_API_KEY"],
    baseNames: ["PIXELTALE_CLAUDE_BASE_URL", "ASSET_ANALYZER_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: "claude-haiku-4-5",
    provider: "claude",
    keyNames: ["PIXELTALE_CLAUDE_API_KEY", "ASSET_ANALYZER_API_KEY"],
    baseNames: ["PIXELTALE_CLAUDE_BASE_URL", "ASSET_ANALYZER_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: GROK_FALLBACK_MODEL,
    provider: "grok",
    fallbackOnly: true,
    keyNames: ["PIXELTALE_GROK_API_KEY", "XAI_API_KEY"],
    baseNames: ["PIXELTALE_GROK_BASE_URL", "XAI_BASE_URL", "GROK_API_BASE_URL", "OPENAI_BASE_URL"],
  },
  {
    id: GEMINI_FALLBACK_MODEL,
    provider: "gemini",
    keyNames: ["PIXELTALE_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
    baseNames: ["PIXELTALE_GEMINI_BASE_URL", "GEMINI_BASE_URL", "GOOGLE_GEMINI_BASE_URL", "OPENAI_BASE_URL"],
  },
]);

function getModelDefinitions() {
  return MODEL_DEFINITIONS.map((item) => item.provider === "gemini" ? { ...item, id: geminiModelId() } : item);
}

function primaryModelIds() {
  return getModelDefinitions().filter((item) => !item.fallbackOnly && !item.legacy).map((item) => item.id);
}

// Retired models stay loadable so historical review records keep showing a real
// model name, but they must never win a seat or reach the model picker again.
const LEGACY_MODEL_IDS = Object.freeze(MODEL_DEFINITIONS.filter((item) => item.legacy).map((item) => item.id));
// Models that used to hold a seat and no longer do. They stay fully usable — the
// user can still pick them by hand — but a stored session that pinned them as a
// seat must move to the current roster, otherwise changing REVIEW_SEATS silently
// has no effect on existing projects. This is a separate concept from `legacy`:
// these models are not retired, they just lost their seat.
const RETIRED_SEAT_MODELS = Object.freeze(["deepseek-v4-pro", "claude-haiku-4-5"]);

function clean(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function firstEnv(names) {
  for (const name of names) {
    const value = clean(process.env[name], 4000);
    if (value) return value;
  }
  return "";
}

function definitionFor(model) {
  const id = clean(model, 120).toLowerCase();
  return getModelDefinitions().find((item) => item.id === id) || null;
}

function modelProvider(model) {
  return definitionFor(model)?.provider || "";
}

function modelConfig(model) {
  const definition = definitionFor(model);
  if (!definition) return null;
  const sharedBase = firstEnv(["PIXELTALE_API_BASE_URL"]);
  return {
    ...definition,
    apiKey: firstEnv(definition.keyNames),
    baseUrl: (firstEnv(definition.baseNames) || sharedBase || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

function models() {
  return primaryModelIds().map((id) => {
    const config = modelConfig(id);
    return { id, provider: config.provider, configured: !!config.apiKey, fallbackOnly: false };
  });
}

function status() {
  const resolved = getModelDefinitions();
  const all = resolved.map((item) => {
    const config = modelConfig(item.id);
    return { id: item.id, provider: item.provider, configured: !!config.apiKey, fallbackOnly: !!item.fallbackOnly };
  });
  const providers = [...new Set(resolved.map((item) => item.provider))];
  return Object.fromEntries(providers.map((provider) => {
    const providerModels = all.filter((item) => item.provider === provider);
    return [provider, {
      provider,
      configured: providerModels.some((item) => item.configured),
      fallbackOnly: providerModels.every((item) => item.fallbackOnly),
      models: providerModels.map(({ id, configured, fallbackOnly }) => ({ id, configured, fallbackOnly })),
    }];
  }));
}

function stageModels(route = {}) {
  return REVIEW_SEATS.map((seat) => {
    const preferred = clean(route[seat.id], 120).toLowerCase();
    const definition = definitionFor(preferred);
    return definition && !definition.legacy ? preferred : seat.model;
  });
}

function fallbackModelsForSeat(seatId, model) {
  const current = clean(model, 120).toLowerCase();
  const seat = clean(seatId, 40);
  const preferred = seat === "seat_a" ? geminiModelId() : (FALLBACK_BY_SEAT[seat] || GROK_FALLBACK_MODEL);
  return [...new Set([preferred, GROK_FALLBACK_MODEL])]
    .filter((candidate) => candidate && candidate !== current && !!modelConfig(candidate)?.apiKey);
}

function fallbackModelFor(model, seatId) {
  return primaryModelIds().includes(clean(model, 120).toLowerCase())
    ? fallbackModelsForSeat(seatId, model)[0] || ""
    : "";
}

function reviewModels(route = {}, { getModelConfig = modelConfig } = {}) {
  const seatModels = stageModels(route);
  const firstSeat = { seat: REVIEW_SEATS[0], index: 0 };
  const secondSeat = REVIEW_SEATS
    .map((seat, index) => ({ seat, index, model: seatModels[index] }))
    .slice(1)
    .find(({ model }) => modelProvider(model) !== modelProvider(seatModels[firstSeat.index]) && !!getModelConfig(model)?.apiKey);
  const selectedSeats = [firstSeat, secondSeat || { seat: REVIEW_SEATS[1], index: 1 }];
  const missingDimensions = REVIEW_DIMENSIONS.filter((dimension) => !selectedSeats
    .some(({ seat }) => seat.ownedDimensions.includes(dimension)));
  const heterogeneous = !!secondSeat;
  return selectedSeats.map(({ seat, index }, selectedIndex) => {
    const model = seatModels[index];
    return {
      seatId: seat.id,
      role: seat.role,
      ownedDimensions: [...seat.ownedDimensions, ...(selectedIndex === 1 ? missingDimensions : [])],
      requiredModel: seat.model,
      model,
      provider: modelProvider(model),
      configured: !!getModelConfig(model)?.apiKey,
      fallbackModels: fallbackModelsForSeat(seat.id, model),
      heterogeneous,
    };
  });
}

function checkReviewFallbackProviders(route = {}) {
  const seats = reviewModels(route).map(({ seatId, model, fallbackModels }) => {
    const fallbackModel = fallbackModels[0] || "";
    return { seatId, model, fallbackModel, provider: modelProvider(fallbackModel) };
  });
  const [firstSeat, secondSeat] = seats;
  const sameProvider = !!firstSeat?.provider && firstSeat.provider === secondSeat?.provider;
  return {
    ok: seats.length === 2 && !!firstSeat?.provider && !!secondSeat?.provider && !sameProvider,
    seats,
    collision: sameProvider
      ? { provider: firstSeat.provider, seats: seats.map((seat) => seat.seatId), models: seats.map((seat) => seat.fallbackModel) }
      : null,
  };
}

function outputText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || "").join("");
  const delta = payload?.choices?.[0]?.delta?.content;
  if (typeof delta === "string") return delta;
  const text = payload?.choices?.[0]?.text;
  if (typeof text === "string") return text;
  const reasoning = payload?.choices?.[0]?.message?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

function parseJsonOutput(raw, label) {
  const value = clean(raw, 240000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? value.slice(start, end + 1) : value;
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      const error = new Error(`${label}未返回合法 JSON`);
      error.code = "INVALID_JSON";
      error.retryable = true;
      throw error;
    }
  }
}

function upstreamMessage(statusCode, raw) {
  const detail = clean(raw, 800);
  return detail ? `模型返回 HTTP ${statusCode}：${detail}` : `模型返回 HTTP ${statusCode}`;
}

async function readStreamPayload(response, { timeoutMs = 240_000 } = {}) {
  if (!response.body) return { content: "", raw: await response.text() };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadlineMs = Date.now() + Math.max(3_000, timeoutMs);
  let pending = "";
  let raw = "";
  let content = "";
  let sawSse = false;
  let finishReason = null;
  let usage = null;
  const processLine = (line) => {
    if (!line.startsWith("data:")) return;
    sawSse = true;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") return;
    raw += value;
    try {
      const parsed = JSON.parse(value);
      content += outputText(parsed);
      // Capture finish_reason from the final content chunk (null in earlier chunks).
      const reason = parsed?.choices?.[0]?.finish_reason;
      if (reason && reason !== "null") finishReason = reason;
      // Some gateways append usage in the last SSE chunk.
      if (parsed?.usage) usage = parsed.usage;
    } catch {
      // A malformed SSE fragment is ignored; the complete response is parsed below.
    }
  };
  while (true) {
    // 读超时兜底：AbortController 在个别 fetch/流实现下可能不中断 read()，
    // 用 Promise.race 保证 read() 本身挂起时也能按墙钟截止强制退出——此前
    // job 曾停在 authoring 30+ 分钟无进展，只能靠 run-job 看门狗收尾。
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      try { await reader.cancel(); } catch { /* 尽力释放流 */ }
      const error = new Error(`流式读取超时（${Math.round(timeoutMs / 1000)} 秒）`);
      error.code = "STREAM_READ_TIMEOUT";
      error.retryable = true;
      throw error;
    }
    let timer;
    let chunk;
    try {
      chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            try { reader.cancel().catch(() => {}); } catch { /* 尽力释放流 */ }
            const error = new Error(`流式读取超时（${Math.round(timeoutMs / 1000)} 秒）`);
            error.code = "STREAM_READ_TIMEOUT";
            error.retryable = true;
            reject(error);
          }, remainingMs);
        }),
      ]);
    } finally {
      // race 胜出后必须清理计时器，否则 pending timer 会拖住进程不退出。
      if (timer) clearTimeout(timer);
    }
    const { done, value } = chunk;
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    lines.forEach(processLine);
  }
  pending += decoder.decode();
  if (pending) processLine(pending);
  if (sawSse) return { content, raw, finishReason, usage };
  return { content: "", raw: pending || raw, finishReason: null, usage: null };
}

async function callPixelTaleApiModel({ model, system, user, purpose = "pixeltale", timeoutMs: requestedTimeoutMs, maxTokens: requestedMaxTokens, temperature = 0.25, signal: externalSignal, fetchImpl = fetch }) {
  const normalizedModel = clean(model, 120).toLowerCase();
  const config = modelConfig(normalizedModel);
  const requestId = `pta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  if (!config) {
    const error = new Error(`PixelTale API 未注册模型：${normalizedModel}`);
    error.code = "MODEL_UNSUPPORTED";
    throw error;
  }
  if (!config.apiKey) {
    const error = new Error(`PixelTale API 模型未配置：${normalizedModel}`);
    error.code = "MODEL_NOT_CONFIGURED";
    throw error;
  }
  const timeoutMs = Math.max(3_000, Number(requestedTimeoutMs) > 0 ? Number(requestedTimeoutMs) : 240_000);
  const maxTokens = Math.max(256, Math.min(16_000, Number(requestedMaxTokens) > 0 ? Math.floor(Number(requestedMaxTokens)) : 4_000));
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${config.baseUrl}${config.baseUrl.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}`;
  const request = {
    model: normalizedModel,
    stream: true,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.25,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: String(system || "") }, { role: "user", content: String(user || "") }],
  };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = await readStreamPayload(response, { timeoutMs });
    if (!response.ok) {
      const error = new Error(upstreamMessage(response.status, payload.raw));
      error.code = "HTTP_ERROR";
      error.status = response.status;
      error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      throw error;
    }
    const rawContent = payload.content || outputText(parseJsonOutput(payload.raw, `${normalizedModel} 上游响应`));
    if (!rawContent.trim()) {
      const error = new Error(`${normalizedModel} 未返回文本内容`);
      error.code = "EMPTY_RESPONSE";
      error.retryable = true;
      throw error;
    }
    // finish_reason "length" means the model hit max_tokens mid-output. This is
    // a payload-sizing issue, not a transient error: retrying with the same budget
    // will keep truncating. Surface it as a distinct non-retryable code so callers
    // can reduce load instead of blindly retrying.
    if (payload.finishReason === "length") {
      const error = new Error(`${normalizedModel} 输出在 max_tokens 处被截断，请减少载荷或提高 maxTokens 上限`);
      error.code = "TRUNCATED_OUTPUT";
      error.retryable = false;
      throw error;
    }
    return {
      provider: config.provider,
      model: normalizedModel,
      content: parseJsonOutput(rawContent, `${normalizedModel} 输出`),
      attempts: 0,
      usage: payload.usage || null,
      trace: [{ requestId, purpose, elapsedMs: Date.now() - startedAt, timeoutMs, stream: true }],
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = externalSignal?.aborted ? "请求已取消" : `请求超时（${Math.round(timeoutMs / 1000)} 秒）`;
      const wrapped = new Error(`${normalizedModel} ${timeout}（追踪号 ${requestId}）`);
      wrapped.code = externalSignal?.aborted ? "REQUEST_CANCELLED" : "TIMEOUT";
      wrapped.retryable = !externalSignal?.aborted;
      throw wrapped;
    }
    if (error?.code) throw error;
    const wrapped = new Error(`${normalizedModel} 网络请求失败：${error?.message || "未知错误"}（追踪号 ${requestId}）`);
    wrapped.code = "NETWORK_ERROR";
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function createPixelTaleApiRouter({ fetchImpl } = {}) {
  const call = (args = {}) => callPixelTaleApiModel({ ...args, fetchImpl: fetchImpl || fetch });
  return { call, models, status, stageModels, reviewModels, checkReviewFallbackProviders, fallbackModelFor, modelProvider };
}

module.exports = {
  GROK_FALLBACK_MODEL,
  GEMINI_FALLBACK_MODEL,
  REVIEW_SEATS,
  LEGACY_MODEL_IDS,
  RETIRED_SEAT_MODELS,
  MODEL_DEFINITIONS,
  callPixelTaleApiModel,
  readStreamPayload,
  createPixelTaleApiRouter,
  modelConfig,
  models,
  status,
  stageModels,
  reviewModels,
  checkReviewFallbackProviders,
  fallbackModelsForSeat,
  fallbackModelFor,
  modelProvider,
};
