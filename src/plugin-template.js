/**
 * @name        Unified Music Source
 * @id          local.unified-music-source
 * @version     __PLUGIN_VERSION__
 * @description 高音质优先、多音源聚合、自动降级、酷我/咪咕跨平台兜底
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

function htmlDecodeLite(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeMatchText(value) {
  return htmlDecodeLite(value)
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/[\s\-—_·•()（）\[\]【】{}'"‘’“”，,。.！!？?：:；;\/\\]+/g, "");
}

function bigramSimilarity(a, b) {
  const x = normalizeMatchText(a);
  const y = normalizeMatchText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.88;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const counts = new Map();
  for (let i = 0; i < x.length - 1; i++) {
    const gram = x.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const gram = y.slice(i, i + 2);
    const n = counts.get(gram) || 0;
    if (n > 0) {
      hits += 1;
      counts.set(gram, n - 1);
    }
  }
  return (2 * hits) / ((x.length - 1) + (y.length - 1));
}

function singerSimilarity(target, candidate) {
  const split = (value) => String(value || "").split(/[\/,，、&;；]+/).map(normalizeMatchText).filter(Boolean);
  const a = split(target);
  const b = split(candidate);
  if (!a.length || !b.length) return 0;
  let best = 0;
  for (const x of a) {
    for (const y of b) best = Math.max(best, bigramSimilarity(x, y));
  }
  return best;
}

function durationSeconds(value) {
  if (value == null || value === "") return 0;
  const text = String(value).trim();
  if (/^\d{1,3}:\d{1,2}$/.test(text)) {
    const [m, s] = text.split(":").map(Number);
    return m * 60 + s;
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10000 ? Math.round(n / 1000) : Math.round(n);
}

function versionPenalty(targetName, candidateName) {
  const target = normalizeMatchText(targetName);
  const candidateRaw = String(candidateName || "").toLowerCase();
  const markers = ["live", "现场", "翻唱", "cover", "伴奏", "remix", "dj", "纯音乐", "instrumental"];
  let penalty = 0;
  for (const marker of markers) {
    if (candidateRaw.includes(marker) && !target.includes(normalizeMatchText(marker))) penalty += 14;
  }
  return Math.min(28, penalty);
}

function candidateScore(req, candidate) {
  const m = req.musicInfo || {};
  const titleSim = bigramSimilarity(m.name, candidate.name);
  if (titleSim < 0.52) return -Infinity;
  const singerSim = singerSimilarity(m.singer, candidate.singer);
  if (String(m.singer || "").trim() && singerSim < 0.3) return -Infinity;

  let score = titleSim * 55 + singerSim * 28;
  const targetDuration = durationSeconds(m.interval || m.duration);
  const candidateDuration = durationSeconds(candidate.duration);
  if (targetDuration && candidateDuration) {
    const diff = Math.abs(targetDuration - candidateDuration);
    if (diff > 20) return -Infinity;
    if (diff <= 3) score += 17;
    else if (diff <= 8) score += 12;
    else score += 6;
  }
  score -= versionPenalty(m.name, candidate.name);
  return Math.round(score);
}

function normalizeHttpUrl(value, baseUrl) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  if (text.startsWith("/") && /^https?:\/\//i.test(String(baseUrl || ""))) {
    return String(baseUrl).replace(/\/$/, "") + text;
  }
  return "";
}

function parseCrossCandidates(body, platform, limit) {
  const search = platform.search || {};
  const fields = search.fields || {};
  const list = getPath(body, search.listPath);
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, limit)) {
    let id = String(getPath(item, fields.idPath) ?? "").trim();
    const stripPrefix = String(fields.idStripPrefix || "");
    if (stripPrefix && id.startsWith(stripPrefix)) id = id.slice(stripPrefix.length);
    const alternateId = String(getPath(item, fields.alternateIdPath) ?? "").trim();
    const name = htmlDecodeLite(getPath(item, fields.namePath));
    const singer = htmlDecodeLite(getPath(item, fields.singerPath));
    const duration = getPath(item, fields.durationPath);
    if (!id || !name) continue;
    let directUrl = "";
    for (const path of fields.directUrlPaths || []) {
      directUrl = normalizeHttpUrl(getPath(item, path), platform.directBaseUrl);
      if (directUrl) break;
    }
    out.push({ id, alternateId, name, singer, duration, directUrl });
  }
  return out;
}

async function searchCrossPlatform(platform, req, timeoutMs, maxCandidates) {
  const search = platform.search || {};
  const m = req.musicInfo || {};
  const keyword = `${String(m.name || "").trim()} ${String(m.singer || "").trim()}`.trim();
  if (!keyword) return [];
  const ctx = {
    keyword,
    name: String(m.name || ""),
    singer: String(m.singer || ""),
    duration: String(m.interval || m.duration || ""),
  };
  const method = String(search.method || "GET").toUpperCase();
  const url = renderUrlString(search.url, ctx);
  const headers = renderRawValue(search.headers || {}, ctx);
  const options = { method, headers, responseType: search.responseType || "json", timeout: timeoutMs };
  const resp = await splayer.request(url, options);
  if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
  const body = normalizeBody(resp.body);
  return parseCrossCandidates(body, platform, maxCandidates)
    .map((candidate) => ({ ...candidate, score: candidateScore(req, candidate), platform }))
    .filter((candidate) => Number.isFinite(candidate.score));
}

function syntheticCrossReq(req, source, id) {
  const musicInfo = { ...(req.musicInfo || {}) };
  musicInfo.id = id;
  musicInfo.songmid = id;
  musicInfo.songId = id;
  musicInfo.hash = id;
  musicInfo.source = source;
  return { source, quality: req.quality, musicInfo };
}

function providerById(config, id) {
  return (config.providers || []).find((provider) => provider.id === id && provider.enabled);
}

async function resolveCrossFallback(req, config, defaults, started, budget, errors) {
  const cross = config.crossFallback;
  if (!cross?.enabled || !Array.isArray(cross.platforms) || !cross.platforms.length) return null;
  const name = String(req.musicInfo?.name || "").trim();
  if (!name) return null;

  let remaining = budget - (Date.now() - started);
  if (remaining <= 1500) return null;
  const searchTimeout = Math.max(700, Math.min(Number(cross.searchTimeoutMs || 2200), remaining - 900));
  const maxCandidates = Math.max(1, Math.min(12, Number(cross.maxCandidatesPerPlatform || 6)));
  const minScore = Math.max(50, Math.min(100, Number(cross.minScore || 70)));
  const platforms = [...cross.platforms].sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  const settled = await Promise.allSettled(platforms.map(async (platform) => ({
    platform,
    candidates: await searchCrossPlatform(platform, req, searchTimeout, maxCandidates),
  })));

  const candidates = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      for (const candidate of result.value.candidates) {
        if (candidate.score >= minScore) candidates.push(candidate);
      }
    } else {
      errors.push(`cross-search: ${String(result.reason?.message || result.reason)}`);
    }
  }

  candidates.sort((a, b) => b.score - a.score || Number(a.platform.priority || 100) - Number(b.platform.priority || 100));
  if (!candidates.length) return null;

  let directBackup = null;
  const maxCrossQualityAttempts = Math.max(1, Math.min(3, Number(cross.maxQualityAttemptsPerProvider || 2)));

  for (const candidate of candidates.slice(0, 4)) {
    const platform = candidate.platform;
    if (platform.allowDirectUrl && candidate.directUrl && !directBackup) {
      directBackup = { url: candidate.directUrl, quality: "lq", crossSource: platform.id, score: candidate.score };
    }

    const ids = [candidate.id, candidate.alternateId].filter((id, index, arr) => id && arr.indexOf(id) === index);
    for (const providerId of platform.resolverProviderIds || []) {
      const provider = providerById(config, providerId);
      if (!provider || !Array.isArray(provider.crossPlatforms) || !provider.crossPlatforms.includes(platform.id)) continue;
      const qualities = qualityCandidates(String(req.quality || "lq"), provider, defaults).slice(0, maxCrossQualityAttempts);
      if (!qualities.length) continue;

      for (const id of ids) {
        for (const qualityKey of qualities) {
          remaining = budget - (Date.now() - started);
          if (remaining <= 900) return directBackup;
          const timeout = Math.max(650, Math.min(Number(defaults.providerTimeoutMs || 2800), remaining - 400));
          const crossReq = syntheticCrossReq(req, platform.id, id);
          const attemptStarted = Date.now();
          try {
            const result = await callProvider(provider, crossReq, qualityKey, timeout);
            recordSuccess(provider.id);
            recordProviderStat(platform.id, provider.id, true, Date.now() - attemptStarted);
            log("info", `cross fallback success platform=${platform.id} provider=${provider.id} score=${candidate.score} quality=${qualityKey}`);
            return { ...result, crossSource: platform.id, matchScore: candidate.score };
          } catch (e) {
            recordProviderStat(platform.id, provider.id, false, Date.now() - attemptStarted);
            errors.push(`cross-${platform.id}/${provider.id}/${qualityKey}: ${String(e?.message || e)}`);
            if (isTimeoutError(e)) break;
          }
        }
      }
    }
  }

  return directBackup;
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
  const crossEnabled = !!config.crossFallback?.enabled && !!String(req.musicInfo?.name || "").trim();
  const crossReserve = crossEnabled
    ? Math.max(3500, Math.min(8500, Number(config.crossFallback?.reserveMs || 6500)))
    : 0;

  providerLoop:
  for (const provider of providers.slice(0, maxProviders)) {
    const providerStarted = Date.now();
    const qualities = qualityCandidates(String(req.quality || "lq"), provider, defaults).slice(0, maxQualityAttempts);
    if (!qualities.length) continue;

    for (const qualityKey of qualities) {
      const remaining = budget - (Date.now() - started);
      if (remaining <= crossReserve + 700) break providerLoop;
      const timeout = Math.max(800, Math.min(perRequest, remaining - crossReserve - 500));
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

  if (crossEnabled) {
    const crossResult = await resolveCrossFallback(req, config, defaults, started, budget, errors);
    if (crossResult?.url) return crossResult;
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
