import { readJson, writeJsonIfChanged, bucketLatency, validateProviderConfig } from "./lib.mjs";

const config = await readJson("config/providers.json");
const { errors } = validateProviderConfig(config);
if (errors.length) throw new Error(errors.join("\n"));

let runtime;
try {
  runtime = await readJson("config/runtime.json");
} catch {
  runtime = { schemaVersion: 1, generation: 0, providers: {} };
}
runtime.providers ||= {};

async function probe(p) {
  const hc = p.healthcheck;
  if (!p.enabled || !hc?.enabled || !hc.url) {
    return { state: "unknown", failureStreak: 0, successStreak: 0, latency: "unknown" };
  }

  const started = Date.now();
  try {
    const res = await fetch(hc.url, {
      method: String(hc.method || "GET").toUpperCase(),
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(1000, Number(hc.timeoutMs || 5000)))
    });
    const okStatuses = Array.isArray(hc.expectedStatus) ? hc.expectedStatus : [200];
    const ok = okStatuses.includes(res.status);
    const prev = runtime.providers[p.id] || {};
    if (!ok) throw new Error(`HTTP ${res.status}`);
    const successStreak = Math.min(10, Number(prev.successStreak || 0) + 1);
    return {
      state: successStreak >= 2 ? "healthy" : "degraded",
      failureStreak: 0,
      successStreak,
      latency: bucketLatency(Date.now() - started)
    };
  } catch (e) {
    const prev = runtime.providers[p.id] || {};
    const failureStreak = Math.min(10, Number(prev.failureStreak || 0) + 1);
    return {
      state: failureStreak >= 3 ? "down" : "degraded",
      failureStreak,
      successStreak: 0,
      latency: "unknown"
    };
  }
}

const nextProviders = {};
for (const p of config.providers) {
  nextProviders[p.id] = await probe(p);
  console.log(`${p.id}: ${nextProviders[p.id].state} (${nextProviders[p.id].latency})`);
}

const prevComparable = JSON.stringify(runtime.providers || {});
const nextComparable = JSON.stringify(nextProviders);
if (prevComparable !== nextComparable) runtime.generation = Number(runtime.generation || 0) + 1;
runtime.schemaVersion = 1;
runtime.providers = nextProviders;

const changed = await writeJsonIfChanged("config/runtime.json", runtime);
console.log(changed ? "runtime.json updated" : "runtime.json unchanged");
