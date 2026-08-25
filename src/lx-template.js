/*!
 * @name Unified Music Source (LX)
 * @description 多音源聚合、自动回退；LX Music 专用
 * @version __PLUGIN_VERSION__
 * @author __AUTHOR__
 * @homepage __HOMEPAGE__
 */

(() => {
  const { EVENT_NAMES, request, on, send, version: lxVersion } = globalThis.lx;
  const CONFIG = __EMBEDDED_CONFIG__;
  const UPDATE_URL = "__LX_UPDATE_URL__";
  const PLUGIN_VERSION = "__PLUGIN_VERSION__";
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
