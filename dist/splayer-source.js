/**
 * @name        Unified Music Source
 * @id          local.unified-music-source
 * @version     1.0.0
 * @description 多源聚合、自动回退、远程配置、健康降级
 * @author      repository-owner
 * @homepage    https://github.com/YOUR_GITHUB_USER/splayer-music-source
 * @type        source
 * @apiLevel    1
 * @updateUrl   https://raw.githubusercontent.com/YOUR_GITHUB_USER/splayer-music-source/main/dist/splayer-source.js
 * @changelog   初始构建
 */

const CONFIG_URL = "https://raw.githubusercontent.com/YOUR_GITHUB_USER/splayer-music-source/main/config/providers.json";
const RUNTIME_URL = "https://raw.githubusercontent.com/YOUR_GITHUB_USER/splayer-music-source/main/config/runtime.json";
const REPOSITORY = "YOUR_GITHUB_USER/splayer-music-source";
const EMBEDDED_CONFIG = {"schemaVersion":1,"revision":1,"defaults":{"configTtlMs":900000,"providerTimeoutMs":3500,"totalBudgetMs":18000,"maxAttempts":4,"circuitBreaker":{"failureThreshold":3,"cooldownMs":600000},"qualityFallback":["hi-res","lossless","hq","sq","lq"]},"providers":[{"id":"example-authorized-api","name":"Example Authorized API","enabled":false,"priority":100,"platforms":["wy","tx","kg"],"description":"示例模板。请替换为你有权使用的公开/自建/官方授权 API。","transport":{"method":"GET","url":"https://example.invalid/music/url?source={source}&id={id}&quality={quality}","responseType":"json","headers":{},"qualityMap":{"lq":"128k","sq":"192k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url","expirePath":"expire","expireUnit":"ms"}},"healthcheck":{"enabled":false,"method":"GET","url":"https://example.invalid/health","expectedStatus":[200],"timeoutMs":5000}},{"id":"example-local-resolver","name":"Example Local Resolver","enabled":false,"priority":200,"platforms":["wy","tx","kg"],"description":"如果以后有自己的本地/局域网 resolver，可启用此模板。","transport":{"method":"GET","url":"http://127.0.0.1:9863/resolve?source={source}&id={id}&name={name}&singer={singer}&quality={quality}","responseType":"json","headers":{},"qualityMap":{"lq":"lq","sq":"sq","hq":"hq","lossless":"lossless","hi-res":"hi-res"},"success":{"status":[200]},"result":{"urlPath":"url","expirePath":"expire","expireUnit":"ms"}},"healthcheck":{"enabled":false,"method":"GET","url":"http://127.0.0.1:9863/health","expectedStatus":[200],"timeoutMs":3000}}]};

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
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
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
    isObject(p) &&
    typeof p.id === "string" &&
    typeof p.enabled === "boolean" &&
    Array.isArray(p.platforms) &&
    isObject(p.transport) &&
    typeof p.transport.url === "string"
  );
}

async function fetchJson(url, timeout) {
  const resp = await splayer.request(url, {
    method: "GET",
    responseType: "json",
    timeout,
  });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
  const body = normalizeBody(resp.body);
  if (!isObject(body)) throw new Error("invalid json");
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
    if (r.schemaVersion === 1 && isObject(r.providers)) runtime = r;
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
  const requested = String(req.quality || "lq");
  const mapped = String(qualityMap[requested] || requested);
  return {
    source: String(req.source || m.source || ""),
    id,
    songmid: id,
    songId: id,
    quality: mapped,
    requestedQuality: requested,
    name: String(m.name || ""),
    singer: String(m.singer || ""),
    duration: String(m.interval || ""),
    album: String(meta.albumName || ""),
  };
}

function renderString(input, ctx) {
  return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    encodeURIComponent(String(ctx[key] ?? ""))
  );
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

  let url;
  if (t.result?.bodyAsUrl) url = typeof body === "string" ? body.trim() : "";
  else url = getPath(body, t.result?.urlPath);

  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new Error("provider returned no valid URL");
  }

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
    .map((p) => ({
      provider: p,
      score: Number(p.priority || 100) + runtimePenalty(p.id, runtime) + localPenalty(p.id, defaults),
    }))
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
  const options = {
    method,
    headers,
    responseType: t.responseType || "json",
    timeout: timeoutMs,
  };

  if (method !== "GET" && t.body !== undefined) {
    const body = renderValue(t.body, ctx);
    if (isObject(body) || Array.isArray(body)) {
      options.body = JSON.stringify(body);
      if (!options.headers["Content-Type"] && !options.headers["content-type"]) {
        options.headers["Content-Type"] = "application/json";
      }
    } else {
      options.body = String(body);
    }
  }

  const resp = await splayer.request(url, options);
  return parseResult(resp, provider);
}

splayer.on("musicUrl", async (req) => {
  if (!SUPPORTED_SOURCES.includes(req.source)) throw new Error(`unsupported source: ${req.source}`);

  const state = await refreshConfig(false);
  const config = state.value;
  const defaults = config.defaults || {};
  const providers = chooseProviders(config, state.runtime, req.source);

  if (!providers.length) {
    throw new Error(
      `No enabled provider for ${req.source}. Configure an authorized provider in ${REPOSITORY}/config/providers.json`
    );
  }

  const started = Date.now();
  const budget = Math.min(19000, Number(defaults.totalBudgetMs || 18000));
  const perProvider = Math.min(7000, Number(defaults.providerTimeoutMs || 3500));
  const maxAttempts = Math.max(1, Math.min(8, Number(defaults.maxAttempts || 4)));
  const errors = [];

  for (const provider of providers.slice(0, maxAttempts)) {
    const elapsed = Date.now() - started;
    const remaining = budget - elapsed;
    if (remaining <= 500) break;

    const timeout = Math.max(1000, Math.min(perProvider, remaining));
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
