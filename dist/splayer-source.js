/**
 * @name        Unified Music Source
 * @id          local.unified-music-source
 * @version     1.0.8
 * @description 多音源聚合、自动回退、远程配置、健康降级
 * @author      LycheeGuo
 * @homepage    https://github.com/LycheeGuo/musicAPI
 * @type        source
 * @apiLevel    1
 * @updateUrl   https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/dist/splayer-source.js
 * @changelog   自动构建 babb22c
 */

const CONFIG_URL = "https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/config/providers.json";
const RUNTIME_URL = "https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/config/runtime.json";
const EMBEDDED_CONFIG = {"schemaVersion":1,"revision":5,"defaults":{"configTtlMs":900000,"providerTimeoutMs":3200,"totalBudgetMs":19000,"maxAttempts":4,"circuitBreaker":{"failureThreshold":3,"cooldownMs":600000},"qualityFallback":["hi-res","lossless","hq","sq","lq"]},"providers":[{"id":"xinghai-main","name":"Xinghai Main","enabled":true,"priority":10,"platforms":["wy","tx","kg"],"description":"公开 JSON API，优先尝试。","transport":{"method":"GET","url":"https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light&types=url&source={source}&id={id}&br={quality}","responseType":"json","headers":{"User-Agent":"LX-Music-Mobile","Accept":"application/json"},"sourceMap":{"wy":"netease","tx":"tencent","kg":"kugou"},"qualityMap":{"lq":"128","sq":"192","hq":"320","lossless":"740","hi-res":"999"},"success":{"status":[200]},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"huibq-share-v3","name":"Huibq Share v3","enabled":true,"priority":20,"publicCredential":true,"platforms":["wy","tx","kg"],"description":"Huibq 公开分享接口。","transport":{"method":"GET","url":"https://lxmusicapi.onrender.com/url/{source}/{id}/{quality}","responseType":"json","headers":{"Content-Type":"application/json","X-Request-Key":"share-v3"},"qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"320k","hi-res":"320k"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"juhe-direct","name":"Juhe Direct","enabled":true,"priority":30,"platforms":["wy","tx","kg"],"description":"聚合 API 的直接 URL 返回模式；仅接受 code=200，不执行服务端下发的二次任意请求。","transport":{"method":"POST","url":"https://api.music.lerd.dpdns.org/{source}","responseType":"json","headers":{"Content-Type":"application/json","Accept":"application/json"},"bodyMode":"lx-music-url","qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"flac","hi-res":"flac"},"success":{"status":[200],"bodyPath":"code","equals":200},"result":{"urlPath":"data.url"}},"healthcheck":{"enabled":false}},{"id":"ikun-public","name":"iKun Public","enabled":true,"priority":40,"platforms":["wy"],"description":"iKun 当前公开接口；在 SPlayer 支持的平台中仅用于网易源。","transport":{"method":"GET","url":"https://api.ikunshare.com/url?source={source}&songId={id}&quality={quality}","responseType":"json","headers":{"Accept":"application/json"},"qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":200},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"example-authorized-api","name":"Example Authorized API","enabled":false,"priority":900,"platforms":["wy","tx","kg"],"description":"保留的自建或官方授权 API 模板。","transport":{"method":"GET","url":"https://example.invalid/music/url?source={source}&id={id}&quality={quality}","responseType":"json","headers":{},"qualityMap":{"lq":"128k","sq":"192k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url","expirePath":"expire","expireUnit":"ms"}},"healthcheck":{"enabled":false,"method":"GET","url":"https://example.invalid/health","expectedStatus":[200],"timeoutMs":5000}}]};

const SUPPORTED_SOURCES = ["wy", "tx", "kg"];
const SUPPORTED_QUALITIES = ["lq", "sq", "hq", "lossless", "hi-res"];
const circuits = new Map();

let configState = {
  value: EMBEDDED_CONFIG,
  runtime: { schemaVersion: 1, providers: {} },
  loadedAt: 0,
};

splayer.register({
  sources: {
    wy: { name: "Unified / 网易", actions: ["musicUrl"], qualities: SUPPORTED_QUALITIES },
    tx: { name: "Unified / QQ", actions: ["musicUrl"], qualities: SUPPORTED_QUALITIES },
    kg: { name: "Unified / 酷狗", actions: ["musicUrl"], qualities: SUPPORTED_QUALITIES },
  },
});

function log(level, ...args) {
  const fn = splayer.log?.[level];
  if (typeof fn === "function") fn(...args);
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPath(obj, path) {
  if (!path) return obj;
  return String(path).split(".").filter(Boolean).reduce((acc, key) => acc == null ? undefined : acc[key], obj);
}

function normalizeBody(body) {
  if (typeof body !== "string") return body;
  const t = body.trim();
  if (!t) return body;
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch {}
  }
  return body;
}

function validConfig(config) {
  if (!isObject(config) || config.schemaVersion !== 1 || !Array.isArray(config.providers)) return false;
  return config.providers.every((p) =>
    isObject(p) && typeof p.id === "string" && typeof p.enabled === "boolean" &&
    Array.isArray(p.platforms) && isObject(p.transport) && typeof p.transport.url === "string"
  );
}

async function fetchJson(url, timeout) {
  const resp = await splayer.request(url, { method: "GET", responseType: "json", timeout });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
  const body = normalizeBody(resp.body);
  if (!isObject(body) && !Array.isArray(body)) throw new Error("invalid json");
  return body;
}

async function refreshConfig(force = false, timeout = 1800) {
  const ttl = Number(configState.value?.defaults?.configTtlMs || 900000);
  if (!force && Date.now() - configState.loadedAt < ttl) return configState;

  const fallback = configState.value || EMBEDDED_CONFIG;
  const requests = await Promise.allSettled([
    fetchJson(CONFIG_URL, timeout),
    fetchJson(RUNTIME_URL, timeout),
  ]);

  let remote = fallback;
  let runtime = configState.runtime;

  const configResult = requests[0];
  if (configResult.status === "fulfilled" && validConfig(configResult.value)) {
    remote = configResult.value;
  } else if (configResult.status === "rejected") {
    log("warn", "providers config fetch failed; using cached/embedded config", String(configResult.reason?.message || configResult.reason));
  }

  const runtimeResult = requests[1];
  if (runtimeResult.status === "fulfilled" && runtimeResult.value?.schemaVersion === 1 && isObject(runtimeResult.value.providers)) {
    runtime = runtimeResult.value;
  }

  configState = { value: remote, runtime, loadedAt: Date.now() };
  return configState;
}

function songContext(req, provider) {
  const m = req.musicInfo || {};
  const meta = isObject(m.meta) ? m.meta : {};
  const id = String(m.songmid || m.id || m.songId || m.hash || "");
  const qualityMap = provider?.transport?.qualityMap || {};
  const sourceMap = provider?.transport?.sourceMap || {};
  const rawSource = String(req.source || m.source || "");
  const requested = String(req.quality || "lq");
  const mapped = String(qualityMap[requested] || requested);
  return {
    source: String(sourceMap[rawSource] || rawSource),
    rawSource,
    id,
    songmid: String(m.songmid || id),
    songId: String(m.songId || id),
    hash: String(m.hash || id),
    quality: mapped,
    requestedQuality: requested,
    name: String(m.name || ""),
    singer: String(m.singer || ""),
    duration: String(m.interval || m.duration || ""),
    album: String(meta.albumName || m.album || ""),
  };
}

function renderUrlString(input, ctx) {
  return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => encodeURIComponent(String(ctx[key] ?? "")));
}

function renderRawString(input, ctx) {
  return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(ctx[key] ?? ""));
}

function renderRawValue(value, ctx) {
  if (typeof value === "string") return renderRawString(value, ctx);
  if (Array.isArray(value)) return value.map((x) => renderRawValue(x, ctx));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderRawValue(v, ctx);
    return out;
  }
  return value;
}

function statusAllowed(status, rule) {
  const allowed = rule?.status;
  return !Array.isArray(allowed) || allowed.includes(status);
}

function bodyRuleAllowed(body, rule) {
  if (!rule?.bodyPath) return true;
  const actual = getPath(body, rule.bodyPath);
  if (Object.prototype.hasOwnProperty.call(rule, "equals")) return actual === rule.equals;
  if (Array.isArray(rule.oneOf)) return rule.oneOf.includes(actual);
  return !!actual;
}

function parseResult(resp, provider) {
  const t = provider.transport;
  const body = normalizeBody(resp.body);
  if (!statusAllowed(resp.status, t.success)) throw new Error(`HTTP ${resp.status}`);
  if (!bodyRuleAllowed(body, t.success)) throw new Error("provider success rule rejected response");

  const value = t.result?.bodyAsUrl ? (typeof body === "string" ? body.trim() : "") : getPath(body, t.result?.urlPath);
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) throw new Error("provider returned no valid URL");

  let expire = getPath(body, t.result?.expirePath);
  if (expire != null) {
    expire = Number(expire);
    if (!Number.isFinite(expire)) expire = undefined;
    else if (t.result?.expireUnit === "s") expire *= 1000;
  }

  return { url: value.trim(), expire };
}

function circuitState(id) {
  const state = circuits.get(id) || { failures: 0, openUntil: 0 };
  if (state.openUntil && Date.now() >= state.openUntil) {
    state.failures = 0;
    state.openUntil = 0;
  }
  return state;
}

function recordSuccess(id) {
  circuits.set(id, { failures: 0, openUntil: 0 });
}

function recordFailure(id, defaults) {
  const threshold = Number(defaults?.circuitBreaker?.failureThreshold || 3);
  const cooldownMs = Number(defaults?.circuitBreaker?.cooldownMs || 600000);
  const state = circuitState(id);
  state.failures += 1;
  if (state.failures >= threshold) state.openUntil = Date.now() + cooldownMs;
  circuits.set(id, state);
}

function runtimePenalty(id, runtime) {
  const state = runtime?.providers?.[id]?.state;
  if (state === "healthy") return 0;
  if (state === "degraded") return 200;
  if (state === "down") return 1000;
  return 50;
}

function localPenalty(id) {
  const c = circuitState(id);
  return c.openUntil > Date.now() ? 5000 : c.failures * 50;
}

function chooseProviders(config, runtime, source) {
  return (config.providers || [])
    .filter((p) => p.enabled && Array.isArray(p.platforms) && p.platforms.includes(source))
    .map((p) => ({
      provider: p,
      score: Number(p.priority || 100) + runtimePenalty(p.id, runtime) + localPenalty(p.id),
    }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.provider);
}

async function callProvider(provider, req, timeoutMs) {
  const t = provider.transport;
  const ctx = songContext(req, provider);
  if (!ctx.id) throw new Error("missing platform song id");

  const method = String(t.method || "GET").toUpperCase();
  const url = renderUrlString(t.url, ctx);
  const headers = renderRawValue(t.headers || {}, ctx);
  const options = { method, headers, responseType: t.responseType || "json", timeout: timeoutMs };

  if (method !== "GET") {
    if (t.bodyMode === "lx-music-url") {
      options.body = JSON.stringify({
        type: ctx.quality,
        musicInfo: req.musicInfo || {},
      });
      if (!options.headers["Content-Type"] && !options.headers["content-type"]) options.headers["Content-Type"] = "application/json";
    } else if (t.body !== undefined) {
      const body = renderRawValue(t.body, ctx);
      if (isObject(body) || Array.isArray(body)) {
        options.body = JSON.stringify(body);
        if (!options.headers["Content-Type"] && !options.headers["content-type"]) options.headers["Content-Type"] = "application/json";
      } else {
        options.body = String(body);
      }
    }
  }

  const resp = await splayer.request(url, options);
  return parseResult(resp, provider);
}

splayer.on("musicUrl", async (req) => {
  if (!SUPPORTED_SOURCES.includes(req.source)) throw new Error(`unsupported source: ${req.source}`);

  const started = Date.now();
  const embeddedDefaults = EMBEDDED_CONFIG.defaults || {};
  const budget = Math.min(19500, Number(embeddedDefaults.totalBudgetMs || 19000));

  const configTimeout = Math.max(800, Math.min(1800, budget - 5000));
  const state = await refreshConfig(false, configTimeout);
  const config = state.value;
  const defaults = config.defaults || {};
  const providers = chooseProviders(config, state.runtime, req.source);
  const perProvider = Math.min(5000, Number(defaults.providerTimeoutMs || 3200));
  const maxAttempts = Math.max(1, Math.min(8, Number(defaults.maxAttempts || 4)));
  const errors = [];

  for (const provider of providers.slice(0, maxAttempts)) {
    const remaining = budget - (Date.now() - started);
    if (remaining <= 1800) break;
    const timeout = Math.max(1000, Math.min(perProvider, remaining - 800));

    try {
      const result = await callProvider(provider, req, timeout);
      recordSuccess(provider.id);
      log("info", `musicUrl success: ${provider.id} source=${req.source}`);
      return {
        url: result.url,
        quality: req.quality,
        ...(result.expire ? { expire: result.expire } : {}),
      };
    } catch (e) {
      recordFailure(provider.id, defaults);
      const msg = `${provider.id}: ${String(e?.message || e)}`;
      errors.push(msg);
      log("warn", `musicUrl provider failed: ${msg}`);
    }
  }

  const err = new Error(`All providers failed (${errors.join(" | ") || "budget exceeded"})`);
  err.code = "UNIFIED_SOURCE_ALL_FAILED";
  throw err;
});
