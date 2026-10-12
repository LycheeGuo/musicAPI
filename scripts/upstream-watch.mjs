import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readJson, writeJsonIfChanged, safeRepo, validateProviderConfig } from "./lib.mjs";
import { adaptHuibq } from "./adapters/huibq.mjs";

export function validateWatch(watch) {
  if (watch?.schemaVersion !== 1 || !Array.isArray(watch.sources) || !watch.sources.length) throw new Error("Invalid watch manifest");
  const ids = new Set();
  for (const item of watch.sources) {
    if (!/^[a-z0-9][a-z0-9-]+$/.test(item.id) || ids.has(item.id) || !safeRepo(item.repo) ||
        typeof item.path !== "string" || !/^[A-Za-z0-9._/-]+\.js$/.test(item.path) || item.path.split("/").some(x => !x || x === "." || x === "..")) {
      throw new Error("Invalid or duplicate upstream entry");
    }
    ids.add(item.id);
  }
}

export async function downloadSource(item, fetchImpl = fetch, token = "") {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "splayer-upstream-watch" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${item.repo}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}`;
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) throw new Error(`Transient HTTP ${res.status}`);
        throw Object.assign(new Error(`HTTP ${res.status}`), { permanent: true });
      }
      const text = await readLimited(res, 1500000);
      data = JSON.parse(text);
      break;
    } catch (error) {
      if (error.permanent || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (data.type !== "file" || !/^[a-f0-9]{40}$/.test(data.sha) || data.encoding !== "base64" ||
      typeof data.content !== "string" || !Number.isInteger(data.size) || data.size < 1 || data.size > 1000000) {
    throw new Error("Invalid GitHub file response or oversized upstream");
  }
  const bytes = Buffer.from(data.content.replace(/\s/g, ""), "base64");
  const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (bytes.length !== data.size || actual !== data.sha) throw new Error("Upstream blob integrity mismatch");
  const code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { sha: actual, code, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function readLimited(res, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("GitHub response too large"), { permanent: true });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function syncUpstreams(watch, oldStatus, config, fetchImpl = fetch, token = "", snapshot = async () => {}) {
  validateWatch(watch);
  const nextConfig = structuredClone(config);
  const sources = {}, report = [], errors = [];
  for (const item of watch.sources) {
    try {
      const file = await downloadSource(item, fetchImpl, token);
      await snapshot(item.id, file.code);
      let integration = "review-required";
      let reason = "No reviewed SPlayer adapter; source downloaded but not executed or included in plugin";
      if (item.id === "pdone-huibq" && item.repo === "pdone/lx-music-source" && item.path === "huibq/latest.js") {
        try {
          const index = nextConfig.providers.findIndex(p => p.id === "huibq-share-v3");
          if (index < 0) throw new Error("Missing Huibq provider");
          nextConfig.providers[index] = adaptHuibq(file.code, nextConfig.providers[index]);
          integration = "adapted";
          reason = "Reviewed Huibq protocol; only allowlisted API origin synchronized";
        } catch (e) { reason = e.message; }
      }
      sources[item.id] = { repo: item.repo, path: item.path, sha: file.sha, sha256: file.sha256, state: "ok", integration };
      const changed = oldStatus.sources?.[item.id]?.sha !== file.sha;
      report.push({ id: item.id, changed, integration, reason });
    } catch (e) {
      errors.push(`${item.id}: ${e.message}`);
      report.push({ id: item.id, integration: "error", reason: e.message });
    }
  }
  const validation = validateProviderConfig(nextConfig);
  errors.push(...validation.errors);
  if (JSON.stringify(config.providers) !== JSON.stringify(nextConfig.providers)) nextConfig.revision = config.revision + 1;
  const changed = JSON.stringify(oldStatus.sources) !== JSON.stringify(sources);
  const status = { schemaVersion: 1, generation: Number(oldStatus.generation || 0) + Number(changed), sources };
  return { status, config: nextConfig, report, errors };
}

async function main() {
  const watch = await readJson("upstreams/watch.json");
  const oldStatus = await readJson("upstreams/status.json");
  const config = await readJson("config/providers.json");
  await fs.mkdir("work/upstreams", { recursive: true });
  const result = await syncUpstreams(watch, oldStatus, config, fetch, process.env.GITHUB_TOKEN || "",
    (id, code) => fs.writeFile(`work/upstreams/${id}.js`, code));
  await fs.writeFile("work/upstreams/report.json", JSON.stringify(result, null, 2) + "\n");
  const lines = ["## Upstream synchronization", ...result.report.map(r => `- ${r.id}: ${r.integration}${r.changed ? " (SHA changed)" : ""}. ${r.reason}`), ...result.errors.map(e => `- ERROR: ${e}`)];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (result.errors.length) throw new Error("Upstream download failed; retained previous status and provider configuration");
  await writeJsonIfChanged("config/providers.json", result.config);
  const changed = await writeJsonIfChanged("upstreams/status.json", result.status);
  console.log(changed ? "Upstream manifest updated" : "No upstream manifest change");
  for (const r of result.report.filter(r => r.integration === "review-required")) console.warn(`::warning title=Upstream review required::${r.id}: ${r.reason}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
