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

  if (!config || typeof config !== "object") errors.push("config 必须是对象");
  if (config?.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (!Array.isArray(config?.providers)) errors.push("providers 必须是数组");

  const ids = new Set();
  for (const [index, p] of (config?.providers || []).entries()) {
    const prefix = `providers[${index}]`;
    if (!p?.id || !/^[a-z0-9][a-z0-9._-]+$/.test(p.id)) errors.push(`${prefix}.id 不合法`);
    if (ids.has(p?.id)) errors.push(`${prefix}.id 重复: ${p?.id}`);
    ids.add(p?.id);
    if (typeof p?.enabled !== "boolean") errors.push(`${prefix}.enabled 必须为 boolean`);
    if (!Number.isFinite(p?.priority)) errors.push(`${prefix}.priority 必须为数字`);
    if (!Array.isArray(p?.platforms) || !p.platforms.every((x) => ["wy", "tx", "kg"].includes(x))) {
      errors.push(`${prefix}.platforms 只能包含 wy/tx/kg`);
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
