import fs from "node:fs/promises";

export async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

export async function writeJsonIfChanged(path, value) {
  const next = JSON.stringify(value, null, 2) + "\n";
  let prev = "";
  try {
    prev = await fs.readFile(path, "utf8");
  } catch {}
  if (prev === next) return false;
  await fs.writeFile(path, next, "utf8");
  return true;
}

export function validateProviderConfig(config) {
  const errors = [];
  const warnings = [];
  const qualityNames = ["lq", "sq", "hq", "lossless", "hi-res"];
  const splayerPlatforms = ["wy", "tx", "kg"];
  const crossPlatforms = ["kw", "mg"];

  if (!config || typeof config !== "object") errors.push("config 必须是对象");
  if (config?.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (!Array.isArray(config?.providers)) errors.push("providers 必须是数组");

  const ids = new Set();
  const providersById = new Map();
  for (const [index, p] of (config?.providers || []).entries()) {
    const prefix = `providers[${index}]`;
    if (!p?.id || !/^[a-z0-9][a-z0-9._-]+$/.test(p.id)) errors.push(`${prefix}.id 不合法`);
    if (ids.has(p?.id)) errors.push(`${prefix}.id 重复: ${p?.id}`);
    ids.add(p?.id);
    providersById.set(p?.id, p);
    if (typeof p?.enabled !== "boolean") errors.push(`${prefix}.enabled 必须为 boolean`);
    if (!Number.isFinite(p?.priority)) errors.push(`${prefix}.priority 必须为数字`);
    if (!Array.isArray(p?.platforms) || !p.platforms.every((x) => splayerPlatforms.includes(x))) {
      errors.push(`${prefix}.platforms 只能包含 wy/tx/kg`);
    }
    if (p?.crossPlatforms !== undefined && (!Array.isArray(p.crossPlatforms) || !p.crossPlatforms.every((x) => crossPlatforms.includes(x)))) {
      errors.push(`${prefix}.crossPlatforms 只能包含 kw/mg`);
    }
    if (p?.qualities !== undefined && (!Array.isArray(p.qualities) || !p.qualities.length || !p.qualities.every((x) => qualityNames.includes(x)))) {
      errors.push(`${prefix}.qualities 只能包含 lq/sq/hq/lossless/hi-res`);
    }

    const t = p?.transport;
    if (!t || !["GET", "POST"].includes(String(t.method || "").toUpperCase())) {
      errors.push(`${prefix}.transport.method 只支持 GET/POST`);
    }
    if (!/^https?:\/\//.test(String(t?.url || ""))) errors.push(`${prefix}.transport.url 必须是 http/https`);
    if (!["json", "text"].includes(t?.responseType || "json")) errors.push(`${prefix}.transport.responseType 只支持 json/text`);
    if (!t?.result?.urlPath && !t?.result?.bodyAsUrl) errors.push(`${prefix}.transport.result 必须声明 urlPath 或 bodyAsUrl`);

    for (const [k, v] of Object.entries(t?.headers || {})) {
      if (/authorization|cookie|x-api-key|x-request-key|token|secret/i.test(k) && String(v || "").trim()) {
        if (!p.publicCredential) {
          errors.push(`${prefix}.transport.headers.${k} 看起来像凭据。公开仓库不得硬编码秘密；若它确实是可公开值，请显式设置 publicCredential: true`);
        } else {
          warnings.push(`${prefix}: ${k} 被标记为 publicCredential，请确认它确实允许公开`);
        }
      }
    }
  }

  const cross = config?.crossFallback;
  if (cross !== undefined) {
    if (!cross || typeof cross !== "object") {
      errors.push("crossFallback 必须是对象");
    } else {
      if (typeof cross.enabled !== "boolean") errors.push("crossFallback.enabled 必须为 boolean");
      if (cross.enabled && (!Array.isArray(cross.platforms) || !cross.platforms.length)) {
        errors.push("crossFallback.platforms 必须是非空数组");
      }
      const seenCross = new Set();
      for (const [index, platform] of (cross.platforms || []).entries()) {
        const prefix = `crossFallback.platforms[${index}]`;
        if (!crossPlatforms.includes(platform?.id)) errors.push(`${prefix}.id 只能是 kw/mg`);
        if (seenCross.has(platform?.id)) errors.push(`${prefix}.id 重复: ${platform?.id}`);
        seenCross.add(platform?.id);
        if (!Number.isFinite(platform?.priority)) errors.push(`${prefix}.priority 必须为数字`);
        if (!Array.isArray(platform?.resolverProviderIds) || !platform.resolverProviderIds.length) {
          errors.push(`${prefix}.resolverProviderIds 必须是非空数组`);
        } else {
          for (const providerId of platform.resolverProviderIds) {
            const provider = providersById.get(providerId);
            if (!provider) {
              errors.push(`${prefix}.resolverProviderIds 引用了不存在的 Provider: ${providerId}`);
            } else if (!Array.isArray(provider.crossPlatforms) || !provider.crossPlatforms.includes(platform.id)) {
              errors.push(`${prefix}: Provider ${providerId} 未声明 crossPlatforms 包含 ${platform.id}`);
            }
          }
        }
        const search = platform?.search;
        if (!search || !["GET", "POST"].includes(String(search?.method || "GET").toUpperCase())) {
          errors.push(`${prefix}.search.method 只支持 GET/POST`);
        }
        if (!/^https?:\/\//.test(String(search?.url || ""))) errors.push(`${prefix}.search.url 必须是 http/https`);
        if (!["json", "text"].includes(search?.responseType || "json")) errors.push(`${prefix}.search.responseType 只支持 json/text`);
        if (!search?.listPath) errors.push(`${prefix}.search.listPath 必填`);
        if (!search?.fields?.idPath || !search?.fields?.namePath || !search?.fields?.singerPath) {
          errors.push(`${prefix}.search.fields 至少需要 idPath/namePath/singerPath`);
        }
        for (const [k, v] of Object.entries(search?.headers || {})) {
          if (/authorization|cookie|x-api-key|x-request-key|token|secret/i.test(k) && String(v || "").trim()) {
            errors.push(`${prefix}.search.headers.${k} 不得包含秘密或访问凭据`);
          }
        }
      }
    }
  }

  return { errors, warnings };
}

export function bucketLatency(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 500) return "fast";
  if (ms < 1500) return "normal";
  if (ms < 3500) return "slow";
  return "very-slow";
}

export function safeRepo(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") ? repo : null;
}
