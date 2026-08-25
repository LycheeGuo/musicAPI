/*!
 * @name Unified Music Source (LX)
 * @description 多音源聚合、自动回退；LX Music 专用
 * @version 1.0.9
 * @author LycheeGuo
 * @homepage https://github.com/LycheeGuo/musicAPI
 */

(() => {
  const { EVENT_NAMES, request, on, send, version: lxVersion } = globalThis.lx;
  const CONFIG = {"schemaVersion":1,"revision":5,"defaults":{"configTtlMs":900000,"providerTimeoutMs":3200,"totalBudgetMs":19000,"maxAttempts":4,"circuitBreaker":{"failureThreshold":3,"cooldownMs":600000},"qualityFallback":["hi-res","lossless","hq","sq","lq"]},"providers":[{"id":"xinghai-main","name":"Xinghai Main","enabled":true,"priority":10,"platforms":["wy","tx","kg"],"description":"公开 JSON API，优先尝试。","transport":{"method":"GET","url":"https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light&types=url&source={source}&id={id}&br={quality}","responseType":"json","headers":{"User-Agent":"LX-Music-Mobile","Accept":"application/json"},"sourceMap":{"wy":"netease","tx":"tencent","kg":"kugou"},"qualityMap":{"lq":"128","sq":"192","hq":"320","lossless":"740","hi-res":"999"},"success":{"status":[200]},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"huibq-share-v3","name":"Huibq Share v3","enabled":true,"priority":20,"publicCredential":true,"platforms":["wy","tx","kg"],"description":"Huibq 公开分享接口。","transport":{"method":"GET","url":"https://lxmusicapi.onrender.com/url/{source}/{id}/{quality}","responseType":"json","headers":{"Content-Type":"application/json","X-Request-Key":"share-v3"},"qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"320k","hi-res":"320k"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"juhe-direct","name":"Juhe Direct","enabled":true,"priority":30,"platforms":["wy","tx","kg"],"description":"聚合 API 的直接 URL 返回模式；仅接受 code=200，不执行服务端下发的二次任意请求。","transport":{"method":"POST","url":"https://api.music.lerd.dpdns.org/{source}","responseType":"json","headers":{"Content-Type":"application/json","Accept":"application/json"},"bodyMode":"lx-music-url","qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"flac","hi-res":"flac"},"success":{"status":[200],"bodyPath":"code","equals":200},"result":{"urlPath":"data.url"}},"healthcheck":{"enabled":false}},{"id":"ikun-public","name":"iKun Public","enabled":true,"priority":40,"platforms":["wy"],"description":"iKun 当前公开接口；在 SPlayer 支持的平台中仅用于网易源。","transport":{"method":"GET","url":"https://api.ikunshare.com/url?source={source}&songId={id}&quality={quality}","responseType":"json","headers":{"Accept":"application/json"},"qualityMap":{"lq":"128k","sq":"128k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":200},"result":{"urlPath":"url"}},"healthcheck":{"enabled":false}},{"id":"example-authorized-api","name":"Example Authorized API","enabled":false,"priority":900,"platforms":["wy","tx","kg"],"description":"保留的自建或官方授权 API 模板。","transport":{"method":"GET","url":"https://example.invalid/music/url?source={source}&id={id}&quality={quality}","responseType":"json","headers":{},"qualityMap":{"lq":"128k","sq":"192k","hq":"320k","lossless":"flac","hi-res":"hires"},"success":{"status":[200],"bodyPath":"code","equals":0},"result":{"urlPath":"url","expirePath":"expire","expireUnit":"ms"}},"healthcheck":{"enabled":false,"method":"GET","url":"https://example.invalid/health","expectedStatus":[200],"timeoutMs":5000}}]};
  const UPDATE_URL = "https://raw.githubusercontent.com/LycheeGuo/musicAPI/main/dist/lx-source.js";
  const PLUGIN_VERSION = "1.0.9";
  const ENABLED_SOURCES = ["wy", "tx", "kg"];
  const LX_QUALITIES = ["128k", "320k", "flac", "flac24bit", "hires"];

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeBody(body) {
    if (typeof body !== "string") return body;
    const text = body.trim();
    if (!text) return body;
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try { return JSON.parse(text); } catch {}
    }
    return body;
  }

  function getPath(obj, path) {
    if (!path) return obj;
    return String(path).split(".").filter(Boolean).reduce((acc, key) => acc == null ? undefined : acc[key], obj);
  }

  function requestAsync(url, options = {}) {
    return new Promise((resolve, reject) => {
      request(url, options, (error, response) => {
        if (error) return reject(error);
        resolve(response || {});
      });
    });
  }

  function canonicalQuality(lxQuality) {
    const q = String(lxQuality || "128k").toLowerCase();
    if (q === "hires" || q === "flac24bit" || q === "24bit") return "hi-res";
    if (q === "flac" || q === "ape" || q === "wav") return "lossless";
    if (q === "320k") return "hq";
    if (q === "192k") return "sq";
    return "lq";
  }

  function buildContext(source, info, provider) {
    const musicInfo = info?.musicInfo || {};
    const id = String(musicInfo.songmid || musicInfo.hash || musicInfo.id || musicInfo.songId || "");
    const canonical = canonicalQuality(info?.type);
    const sourceMap = provider?.transport?.sourceMap || {};
    const qualityMap = provider?.transport?.qualityMap || {};
    return {
      source: String(sourceMap[source] || source),
      rawSource: String(source || ""),
      id,
      songmid: id,
      songId: id,
      quality: String(qualityMap[canonical] || info?.type || "128k"),
      requestedQuality: String(info?.type || "128k"),
      name: String(musicInfo.name || ""),
      singer: String(musicInfo.singer || ""),
      duration: String(musicInfo.interval || ""),
      album: String(musicInfo.albumName || musicInfo.album || ""),
    };
  }

  function renderUrl(input, ctx) {
    return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => encodeURIComponent(String(ctx[key] ?? "")));
  }

  function renderRaw(input, ctx) {
    return String(input).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(ctx[key] ?? ""));
  }

  function renderValue(value, ctx) {
    if (typeof value === "string") return renderRaw(value, ctx);
    if (Array.isArray(value)) return value.map((item) => renderValue(item, ctx));
    if (isObject(value)) {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = renderValue(item, ctx);
      return out;
    }
    return value;
  }

  function parseResult(response, provider) {
    const transport = provider.transport || {};
    const body = normalizeBody(response.body);
    const status = Number(response.statusCode || response.status || 200);
    const allowedStatus = transport.success?.status;
    if (Array.isArray(allowedStatus) && !allowedStatus.includes(status)) {
      throw new Error(`HTTP ${status}`);
    }

    if (transport.success?.bodyPath) {
      const actual = getPath(body, transport.success.bodyPath);
      if (Object.prototype.hasOwnProperty.call(transport.success, "equals") && actual !== transport.success.equals) {
        throw new Error(`provider code=${String(actual)}`);
      }
      if (Array.isArray(transport.success.oneOf) && !transport.success.oneOf.includes(actual)) {
        throw new Error(`provider code=${String(actual)}`);
      }
    }

    const url = transport.result?.bodyAsUrl
      ? (typeof body === "string" ? body.trim() : "")
      : getPath(body, transport.result?.urlPath);
    if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
      throw new Error("provider returned no valid URL");
    }
    return url.trim();
  }

  async function callProvider(provider, source, info) {
    const transport = provider.transport || {};
    const ctx = buildContext(source, info, provider);
    if (!ctx.id) throw new Error("missing song id");

    const method = String(transport.method || "GET").toUpperCase();
    const url = renderUrl(transport.url, ctx);
    const headers = renderValue(transport.headers || {}, ctx);
    const options = { method, headers };

    if (method !== "GET") {
      let body;
      if (transport.bodyMode === "lx-music-url") {
        body = JSON.stringify(info || {});
      } else if (transport.body !== undefined) {
        const rendered = renderValue(transport.body, ctx);
        body = isObject(rendered) || Array.isArray(rendered) ? JSON.stringify(rendered) : String(rendered);
      }
      if (body !== undefined) options.body = body;
    }

    const response = await requestAsync(url, options);
    return parseResult(response, provider);
  }

  function providersFor(source) {
    return (CONFIG.providers || [])
      .filter((provider) => provider.enabled && Array.isArray(provider.platforms) && provider.platforms.includes(source))
      .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
  }

  async function resolveMusicUrl(source, info) {
    const errors = [];
    for (const provider of providersFor(source)) {
      try {
        const url = await callProvider(provider, source, info);
        console.log(`[Unified/LX] ${provider.id} success: ${source}`);
        return url;
      } catch (error) {
        const message = `${provider.id}: ${String(error?.message || error)}`;
        errors.push(message);
        console.warn(`[Unified/LX] ${message}`);
      }
    }
    throw new Error(`All providers failed (${errors.join(" | ") || "no provider"})`);
  }

  const sources = {};
  for (const source of ENABLED_SOURCES) {
    if (!providersFor(source).length) continue;
    sources[source] = {
      name: `Unified / ${source}`,
      type: "music",
      actions: ["musicUrl"],
      qualitys: LX_QUALITIES,
    };
  }

  on(EVENT_NAMES.request, ({ action, source, info }) => {
    if (action !== "musicUrl") return Promise.reject(new Error(`action(${action}) not supported`));
    return resolveMusicUrl(source, info);
  });

  send(EVENT_NAMES.inited, {
    status: true,
    openDevTools: false,
    sources,
  });

  async function checkUpdate() {
    if (!EVENT_NAMES.updateAlert || !UPDATE_URL || !/^https?:\/\//i.test(UPDATE_URL)) return;
    try {
      const response = await requestAsync(`${UPDATE_URL}?t=${Date.now()}`, { method: "GET" });
      const body = typeof response.body === "string" ? response.body : "";
      const match = body.match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/);
      if (!match || match[1] === PLUGIN_VERSION) return;
      const local = PLUGIN_VERSION.split(".").map(Number);
      const remote = match[1].split(".").map(Number);
      let newer = false;
      for (let i = 0; i < Math.max(local.length, remote.length); i++) {
        const r = remote[i] || 0;
        const l = local[i] || 0;
        if (r > l) { newer = true; break; }
        if (r < l) break;
      }
      if (newer) {
        send(EVENT_NAMES.updateAlert, {
          log: `Unified Music Source (LX) ${match[1]} 可更新`,
          updateUrl: UPDATE_URL,
        });
      }
    } catch (error) {
      console.warn("[Unified/LX] update check failed", error);
    }
  }

  Promise.resolve().then(checkUpdate);
  console.log(`[Unified/LX] initialized v${PLUGIN_VERSION}, LX=${lxVersion || "unknown"}`);
})();
