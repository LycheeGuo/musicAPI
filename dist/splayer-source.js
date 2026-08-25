/**
 * @name        Unified Music Source
 * @id          local.unified-music-source
 * @version     1.0.6
 * @description 多源聚合、自动回退、YouTube 公开内容兜底
 * @author      LycheeGuo
 * @homepage    https://github.com/LycheeGuo/musicAPI
 * @type        source
 * @apiLevel    1
 * @updateUrl   https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/dist/splayer-source.js
 * @changelog   自动构建 821ba18
 */

const CONFIG_URL = "https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/config/providers.json";
const RUNTIME_URL = "https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/config/runtime.json";
const REPOSITORY = "LycheeGuo/musicAPI";
const EMBEDDED_CONFIG = {"schemaVersion":1,"revision":3,"defaults":{"configTtlMs":900000,"providerTimeoutMs":3500,"totalBudgetMs":19000,"maxAttempts":4,"circuitBreaker":{"failureThreshold":3,"cooldownMs":600000},"qualityFallback":["hi-res","lossless","hq","sq","lq"]},"youtubeFallback":{"enabled":true,"maxInstances":3,"searchLimit":8,"minScore":45,"durationToleranceSec":35,"instances":["https://pipedapi.kavin.rocks","https://pipedapi.leptons.xyz","https://piped-api.privacy.com.de","https://pipedapi.adminforge.de","https://api.piped.private.coffee"]},"providers":[{"id":"xinghai-main","name":"Xinghai Main","enabled":true,"priority":10,"platforms":["wy","tx","kg"],"description":"公开 JSON API。返回体中的 url 作为播放地址。","transport":{"method":"GET","url":"https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light&types=url&source={source}&id={id}&br={quality}","responseType":"json","headers":{"User-Agent":"LX-Music-Mobile","Accept":"application/json"},"sourceMap":{"wy":"netease","tx":"tencent","kg":"kugou"},"qualityMap":{"lq":"128","sq":"192","hq":"320","lossless":"740","hi-res":"999"},"success":{"status":[200]},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"huibq-share-v3","name":"Huibq Share v3","enabled":true,"priority":20,"publicCredential":true,"platforms":["wy","tx","kg"],"description":"Huibq 公开分享接口，使用其公开 share-v3 请求值。","transport":{"method":"GET","url":"https://lxmusicapi.onrender.com/url/{source}/{id}/{quality}","responseType":"json","headers":{"Content-Type":"application/json","X-Request-Key":"share-v3"},"qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"320k","hi-res":"320k"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"example-authorized-api","name":"Example Authorized API","enabled":false,"priority":900,"platforms":["wy","tx","kg"],"description":"保留的自建/官方授权 API 模板。","transport":{"method":"GET","url":"https://example.invalid/music/url?source={source}&id={id}&quality={quality}","responseType":"json","headers":{},"qualityMap":{"lq":"128k","sq":"192k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url","expirePath":"expire","expireUnit":"ms"}},"healthcheck":{"enabled":false,"method":"GET","url":"https://example.invalid/health","expectedStatus":[200],"timeoutMs":5000}}]};

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

async function refreshConfig(force = false) {
  const ttl = Number(configState.value?.defaults?.configTtlMs || 900000);
  if (!force && Date.now() - configState.loadedAt < ttl) return configState;

  const fallback = configState.value || EMBEDDED_CONFIG;
  const timeout = Math.min(6000, Number(fallback?.defaults?.providerTimeoutMs || 3500));
  let remote = fallback;
  let runtime = configState.runtime;

  try {
    const candidate = await fetchJson(CONFIG_URL, timeout);
    if (validConfig(candidate)) remote = candidate;
    else log("warn", "remote providers config rejected");
  } catch (e) {
    log("warn", "providers config fetch failed; using cached/embedded config", String(e?.message || e));
  }

  try {
    const r = await fetchJson(RUNTIME_URL, timeout);
    if (r?.schemaVersion === 1 && isObject(r.providers)) runtime = r;
  } catch (e) {
    log("warn", "runtime health fetch failed; continuing", String(e?.message || e));
  }

  configState = { value: remote, runtime, loadedAt: Date.now() };
  return configState;
}

function songContext(req, provider) {
  const m = req.musicInfo || {};
  const meta = isObject(m.meta) ? m.meta : {};
  const id = String(m.songmid || m.id || m.songId || "");
  const qualityMap = provider?.transport?.qualityMap || {};
  const sourceMap = provider?.transport?.sourceMap || {};
  const rawSource = String(req.source || m.source || "");
  const requested = String(req.quality || "lq");
  const mapped = String(qualityMap[requested] || requested);
  return {
    source: String(sourceMap[rawSource] || rawSource), rawSource, id, songmid: id, songId: id,
    quality: mapped, requestedQuality: requested, name: String(m.name || ""),
    singer: String(m.singer || ""), duration: String(m.interval || ""), album: String(meta.albumName || "")
  };
}

function renderString(input, ctx) {
  return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => encodeURIComponent(String(ctx[key] ?? "")));
}

function renderValue(value, ctx) {
  if (typeof value === "string") return renderString(value, ctx);
  if (Array.isArray(value)) return value.map((x) => renderValue(x, ctx));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderValue(v, ctx);
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

  let url = t.result?.bodyAsUrl ? (typeof body === "string" ? body.trim() : "") : getPath(body, t.result?.urlPath);
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) throw new Error("provider returned no valid URL");

  let expire = getPath(body, t.result?.expirePath);
  if (expire != null) {
    expire = Number(expire);
    if (!Number.isFinite(expire)) expire = undefined;
    else if (t.result?.expireUnit === "s") expire *= 1000;
  }
  return { url: url.trim(), expire };
}

function circuitState(id, defaults) {
  const state = circuits.get(id) || { failures: 0, openUntil: 0 };
  if (state.openUntil && Date.now() >= state.openUntil) { state.failures = 0; state.openUntil = 0; }
  return state;
}

function recordSuccess(id) { circuits.set(id, { failures: 0, openUntil: 0 }); }

function recordFailure(id, defaults) {
  const threshold = Number(defaults?.circuitBreaker?.failureThreshold || 3);
  const cooldownMs = Number(defaults?.circuitBreaker?.cooldownMs || 600000);
  const state = circuitState(id, defaults);
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

function localPenalty(id, defaults) {
  const c = circuitState(id, defaults);
  return c.openUntil > Date.now() ? 5000 : c.failures * 50;
}

function chooseProviders(config, runtime, source) {
  const defaults = config.defaults || {};
  return (config.providers || [])
    .filter((p) => p.enabled && Array.isArray(p.platforms) && p.platforms.includes(source))
    .map((p) => ({ provider: p, score: Number(p.priority || 100) + runtimePenalty(p.id, runtime) + localPenalty(p.id, defaults) }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.provider);
}

async function callProvider(provider, req, timeoutMs) {
  const t = provider.transport;
  const ctx = songContext(req, provider);
  if (!ctx.id) throw new Error("missing platform song id");

  const method = String(t.method || "GET").toUpperCase();
  const url = renderString(t.url, ctx);
  const headers = renderValue(t.headers || {}, ctx);
  const options = { method, headers, responseType: t.responseType || "json", timeout: timeoutMs };

  if (method !== "GET" && t.body !== undefined) {
    const body = renderValue(t.body, ctx);
    if (isObject(body) || Array.isArray(body)) {
      options.body = JSON.stringify(body);
      if (!options.headers["Content-Type"] && !options.headers["content-type"]) options.headers["Content-Type"] = "application/json";
    } else options.body = String(body);
  }

  const resp = await splayer.request(url, options);
  return parseResult(resp, provider);
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKC")
    .replace(/[\[\]【】()（）]/g, " ")
    .replace(/[\s\-_.·•,:：'\"“”‘’/\\]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function durationSeconds(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function videoIdFrom(item) {
  const direct = item?.videoId || item?.id;
  if (typeof direct === "string" && /^[\w-]{6,}$/.test(direct)) return direct;
  const u = String(item?.url || item?.link || "");
  const m = u.match(/[?&]v=([\w-]{6,})/) || u.match(/\/watch\/([\w-]{6,})/);
  return m?.[1] || "";
}

function candidateScore(item, req, cfg) {
  const m = req.musicInfo || {};
  const wantedTitle = norm(m.name);
  const wantedArtist = norm(m.singer);
  const title = norm(item?.title);
  const uploader = norm(item?.uploaderName || item?.uploader || item?.channelName);
  if (!wantedTitle || !title) return -999;

  let score = 0;
  if (title.includes(wantedTitle)) score += 60;
  else if (wantedTitle.includes(title)) score += 35;
  else {
    let hits = 0;
    for (const ch of [...new Set(wantedTitle)]) if (title.includes(ch)) hits++;
    score += Math.round(35 * hits / Math.max(1, new Set(wantedTitle).size));
  }

  if (wantedArtist) {
    if (title.includes(wantedArtist)) score += 28;
    if (uploader.includes(wantedArtist)) score += 22;
  }

  const targetDur = durationSeconds(m.interval);
  const candDur = durationSeconds(item?.duration);
  if (targetDur && candDur) {
    const diff = Math.abs(targetDur - candDur);
    if (diff <= 5) score += 25;
    else if (diff <= 12) score += 18;
    else if (diff <= Number(cfg.durationToleranceSec || 35)) score += 8;
    else score -= 30;
  }

  const requested = norm(`${m.name || ""} ${m.singer || ""}`);
  const rawTitle = String(item?.title || "").toLowerCase();
  for (const bad of ["live", "cover", "karaoke", "伴奏", "翻唱", "remix", "nightcore", "sped up", "slowed"]){
    if (rawTitle.includes(bad) && !requested.includes(norm(bad))) score -= 18;
  }
  if (item?.uploaderVerified === true || item?.verified === true) score += 5;
  return score;
}

function searchItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

function bestAudioStream(body) {
  const streams = Array.isArray(body?.audioStreams) ? body.audioStreams : [];
  return streams
    .filter((x) => typeof x?.url === "string" && /^https?:\/\//i.test(x.url))
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0] || null;
}

async function youtubeFallback(req, cfg, totalRemainingMs) {
  if (!cfg?.enabled) throw new Error("YouTube fallback disabled");
  const m = req.musicInfo || {};
  if (!m.name) throw new Error("YouTube fallback missing title");

  const instances = Array.isArray(cfg.instances) ? cfg.instances.filter((x) => /^https:\/\//.test(String(x))) : [];
  if (!instances.length) throw new Error("YouTube fallback has no instances");
  const maxInstances = Math.max(1, Math.min(Number(cfg.maxInstances || 2), instances.length));
  const query = `${m.name || ""} ${m.singer || ""}`.trim();
  const errors = [];

  for (const base of instances.slice(0, maxInstances)) {
    const started = Date.now();
    const timeout = Math.max(1500, Math.min(4000, totalRemainingMs - 500));
    if (timeout < 1500) break;
    try {
      const searchUrl = `${String(base).replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&filter=videos`;
      const searchResp = await splayer.request(searchUrl, { method: "GET", responseType: "json", timeout });
      if (searchResp.status < 200 || searchResp.status >= 300) throw new Error(`search HTTP ${searchResp.status}`);
      const items = searchItems(normalizeBody(searchResp.body))
        .filter((x) => videoIdFrom(x))
        .slice(0, Math.max(1, Number(cfg.searchLimit || 8)))
        .map((x) => ({ item: x, score: candidateScore(x, req, cfg) }))
        .sort((a, b) => b.score - a.score);

      const best = items[0];
      if (!best || best.score < Number(cfg.minScore || 45)) throw new Error(`no confident match (score ${best?.score ?? "none"})`);
      const videoId = videoIdFrom(best.item);
      const spent = Date.now() - started;
      const streamTimeout = Math.max(1500, Math.min(4500, totalRemainingMs - spent - 500));
      const streamUrl = `${String(base).replace(/\/$/, "")}/streams/${encodeURIComponent(videoId)}`;
      const streamResp = await splayer.request(streamUrl, { method: "GET", responseType: "json", timeout: streamTimeout });
      if (streamResp.status < 200 || streamResp.status >= 300) throw new Error(`streams HTTP ${streamResp.status}`);
      const stream = bestAudioStream(normalizeBody(streamResp.body));
      if (!stream) throw new Error("no audioStreams");

      log("info", `YouTube fallback success: ${best.item?.title || videoId} score=${best.score}`);
      return { url: stream.url, quality: "lq" };
    } catch (e) {
      errors.push(`${base}: ${String(e?.message || e)}`);
    }
  }
  throw new Error(`YouTube fallback failed (${errors.join(" | ")})`);
}

splayer.on("musicUrl", async (req) => {
  if (!SUPPORTED_SOURCES.includes(req.source)) throw new Error(`unsupported source: ${req.source}`);

  const state = await refreshConfig(false);
  const config = state.value;
  const defaults = config.defaults || {};
  const providers = chooseProviders(config, state.runtime, req.source);
  const started = Date.now();
  const budget = Math.min(19500, Number(defaults.totalBudgetMs || 19000));
  const perProvider = Math.min(6000, Number(defaults.providerTimeoutMs || 3500));
  const maxAttempts = Math.max(1, Math.min(8, Number(defaults.maxAttempts || 4)));
  const errors = [];

  for (const provider of providers.slice(0, maxAttempts)) {
    const remaining = budget - (Date.now() - started);
    if (remaining <= 2500) break;
    const timeout = Math.max(1200, Math.min(perProvider, remaining - 1500));
    try {
      const result = await callProvider(provider, req, timeout);
      recordSuccess(provider.id);
      log("info", `musicUrl success: ${provider.id} source=${req.source}`);
      return { url: result.url, quality: req.quality, ...(result.expire ? { expire: result.expire } : {}) };
    } catch (e) {
      recordFailure(provider.id, defaults);
      const msg = `${provider.id}: ${String(e?.message || e)}`;
      errors.push(msg);
      log("warn", `musicUrl provider failed: ${msg}`);
    }
  }

  const remaining = budget - (Date.now() - started);
  if (remaining > 2500 && config.youtubeFallback?.enabled) {
    try {
      return await youtubeFallback(req, config.youtubeFallback, remaining);
    } catch (e) {
      errors.push(String(e?.message || e));
      log("warn", String(e?.message || e));
    }
  }

  const err = new Error(`All providers failed (${errors.join(" | ") || "budget exceeded"})`);
  err.code = "UNIFIED_SOURCE_ALL_FAILED";
  throw err;
});
