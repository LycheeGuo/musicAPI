/**
 * @name        Unified Music Source
 * @id          local.unified-music-source
 * @version     __PLUGIN_VERSION__
 * @description 高音质优先、多音源聚合、自动降级、智能回退
 * @author      __AUTHOR__
 * @homepage    __HOMEPAGE__
 * @type        source
 * @apiLevel    1
 * @updateUrl   __UPDATE_URL__
 * @changelog   __CHANGELOG__
 */

const CONFIG_URL = "__CONFIG_URL__";
const RUNTIME_URL = "__RUNTIME_URL__";
const EMBEDDED_CONFIG = __EMBEDDED_CONFIG__;

const SUPPORTED_SOURCES = ["wy", "tx", "kg"];
const SUPPORTED_QUALITIES = ["lq", "sq", "hq", "lossless", "hi-res"];
const DEFAULT_QUALITY_ORDER = ["hi-res", "lossless", "hq", "sq", "lq"];
const circuits = new Map();
const providerStats = new Map();
const urlCache = new Map();
const inFlight = new Map();

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

async function refreshConfig(force = false, timeout = 1600) {
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

function musicId(req) {
  const m = req.musicInfo || {};
  return String(m.songmid || m.id || m.songId || m.hash || "");
}

function cacheKey(req) {
  const id = musicId(req);
  if (!id) return "";
  return `${String(req.source || "")}:${id}:${String(req.quality || "lq")}`;
}

function songContext(req, provider, qualityKey) {
  const m = req.musicInfo || {};
  const meta = isObject(m.meta) ? m.meta : {};
  const id = musicId(req);
  const qualityMap = provider?.transport?.qualityMap || {};
  const sourceMap = provider?.transport?.sourceMap || {};
  const rawSource = String(req.source || m.source || "");
  const mapped = String(qualityMap[qualityKey] || qualityKey);
  return {
    source: String(sourceMap[rawSource] || rawSource),
    rawSource,
    id,
    songmid: String(m.songmid || id),
    songId: String(m.songId || id),
    hash: String(m.hash || id),
    quality: mapped,
    requestedQuality: String(req.quality || "lq"),
    actualQuality: qualityKey,
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

function parseResult(resp, provider, qualityKey) {
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

  return { url: value.trim(), expire, quality: qualityKey };
}

function qualityOrder(defaults) {
  const configured = Array.isArray(defaults?.qualityFallback) ? defaults.qualityFallback : DEFAULT_QUALITY_ORDER;
  const clean = configured.filter((q, i) => SUPPORTED_QUALITIES.includes(q) && configured.indexOf(q) === i);
  return clean.length ? clean : DEFAULT_QUALITY_ORDER;
}

function qualityCandidates(requested, provider, defaults) {
  const order = qualityOrder(defaults);
  const requestQuality = SUPPORTED_QUALITIES.includes(requested) ? requested : "lq";
  const start = Math.max(0, order.indexOf(requestQuality));
  const allowed = order.slice(start);
  const supported = Array.isArray(provider.qualities) && provider.qualities.length ? provider.qualities : SUPPORTED_QUALITIES;
  const qualityMap = provider?.transport?.qualityMap || {};
  const seenMapped = new Set();
  const result = [];

  for (const q of allowed) {
    if (!supported.includes(q)) continue;
    const mapped = String(qualityMap[q] || q);
    if (seenMapped.has(mapped)) continue;
    seenMapped.add(mapped);
    result.push(q);
  }
  return result;
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

function statKey(source, providerId) {
  return `${source}:${providerId}`;
}

function statState(source, providerId) {
  return providerStats.get(statKey(source, providerId)) || { successes: 0, failures: 0, avgLatency: 0 };
}

function recordProviderStat(source, providerId, ok, latency) {
  const key = statKey(source, providerId);
  const s = statState(source, providerId);
  if (ok) s.successes += 1;
  else s.failures += 1;
  if (Number.isFinite(latency) && latency >= 0) {
    s.avgLatency = s.avgLatency ? Math.round(s.avgLatency * 0.7 + latency * 0.3) : latency;
  }
  providerStats.set(key, s);
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

function adaptivePenalty(source, id) {
  const s = statState(source, id);
  const total = s.successes + s.failures;
  if (!total) return 0;
  const failureRate = s.failures / total;
  const latencyPenalty = Math.min(100, Math.round((s.avgLatency || 0) / 30));
  const successBonus = Math.min(30, s.successes * 4);
  return Math.round(failureRate * 140) + latencyPenalty - successBonus;
}

function chooseProviders(config, runtime, source) {
  return (config.providers || [])
    .filter((p) => p.enabled && Array.isArray(p.platforms) && p.platforms.includes(source))
    .map((p) => ({
      provider: p,
      score: Number(p.priority || 100) + runtimePenalty(p.id, runtime) + localPenalty(p.id) + adaptivePenalty(source, p.id),
    }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.provider);
}

function isTimeoutError(error) {
  return /timeout|timed out|etimedout/i.test(String(error?.message || error));
}

async function callProvider(provider, req, qualityKey, timeoutMs) {
  const t = provider.transport;
  const ctx = songContext(req, provider, qualityKey);
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
  return parseResult(resp, provider, qualityKey);
}

function getCached(key) {
  if (!key) return null;
  const item = urlCache.get(key);
  if (!item) return null;
  if (Date.now() >= item.expiresAt) {
    urlCache.delete(key);
    return null;
  }
  return item.result;
}

function putCached(key, result, defaults) {
  if (!key || !result?.url) return;
  const now = Date.now();
  const ttl = Math.max(30000, Math.min(1800000, Number(defaults?.urlCacheTtlMs || 300000)));
  let expiresAt = now + ttl;
  if (Number.isFinite(result.expire) && result.expire > now + 10000) expiresAt = Math.min(expiresAt, result.expire - 10000);
  if (expiresAt > now + 5000) urlCache.set(key, { result, expiresAt });
}

async function resolveMusicUrl(req) {
  const started = Date.now();
  const embeddedDefaults = EMBEDDED_CONFIG.defaults || {};
  const budget = Math.min(19500, Number(embeddedDefaults.totalBudgetMs || 19000));
  const configTimeout = Math.max(700, Math.min(1600, budget - 5000));
  const state = await refreshConfig(false, configTimeout);
  const config = state.value;
  const defaults = config.defaults || {};
  const providers = chooseProviders(config, state.runtime, req.source);
  const perRequest = Math.min(4500, Number(defaults.providerTimeoutMs || 2800));
  const maxProviders = Math.max(1, Math.min(8, Number(defaults.maxAttempts || 6)));
  const maxQualityAttempts = Math.max(1, Math.min(4, Number(defaults.maxQualityAttemptsPerProvider || 3)));
  const errors = [];

  providerLoop:
  for (const provider of providers.slice(0, maxProviders)) {
    const providerStarted = Date.now();
    const qualities = qualityCandidates(String(req.quality || "lq"), provider, defaults).slice(0, maxQualityAttempts);
    if (!qualities.length) continue;

    for (const qualityKey of qualities) {
      const remaining = budget - (Date.now() - started);
      if (remaining <= 1400) break providerLoop;
      const timeout = Math.max(800, Math.min(perRequest, remaining - 600));
      const attemptStarted = Date.now();

      try {
        const result = await callProvider(provider, req, qualityKey, timeout);
        const latency = Date.now() - attemptStarted;
        recordSuccess(provider.id);
        recordProviderStat(req.source, provider.id, true, Date.now() - providerStarted);
        log("info", `musicUrl success provider=${provider.id} source=${req.source} quality=${qualityKey} ${latency}ms`);
        return result;
      } catch (e) {
        const latency = Date.now() - attemptStarted;
        const msg = `${provider.id}/${qualityKey}: ${String(e?.message || e)}`;
        errors.push(msg);
        log("warn", `musicUrl failed ${msg} ${latency}ms`);
        if (isTimeoutError(e)) break;
      }
    }

    recordFailure(provider.id, defaults);
    recordProviderStat(req.source, provider.id, false, Date.now() - providerStarted);
  }

  const err = new Error(`All providers failed (${errors.join(" | ") || "budget exceeded/no provider"})`);
  err.code = "UNIFIED_SOURCE_ALL_FAILED";
  throw err;
}

splayer.on("musicUrl", async (req) => {
  if (!SUPPORTED_SOURCES.includes(req.source)) throw new Error(`unsupported source: ${req.source}`);

  const key = cacheKey(req);
  const cached = getCached(key);
  if (cached) {
    log("info", `musicUrl cache hit source=${req.source} quality=${cached.quality}`);
    return cached;
  }

  if (key && inFlight.has(key)) {
    log("info", `musicUrl join in-flight source=${req.source}`);
    return inFlight.get(key);
  }

  const task = resolveMusicUrl(req).then((result) => {
    putCached(key, result, configState.value?.defaults || EMBEDDED_CONFIG.defaults || {});
    return {
      url: result.url,
      quality: result.quality || req.quality,
      ...(result.expire ? { expire: result.expire } : {}),
    };
  });

  if (key) inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (key) inFlight.delete(key);
  }
});
