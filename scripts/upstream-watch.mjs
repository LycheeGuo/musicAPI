import { readJson, writeJsonIfChanged } from "./lib.mjs";

const watch = await readJson("upstreams/watch.json");
let oldStatus;
try {
  oldStatus = await readJson("upstreams/status.json");
} catch {
  oldStatus = { schemaVersion: 1, generation: 0, sources: {} };
}

const token = process.env.GITHUB_TOKEN || "";
const headers = {
  "Accept": "application/vnd.github+json",
  "User-Agent": "splayer-upstream-watch"
};
if (token) headers.Authorization = `Bearer ${token}`;

const next = {};
for (const item of watch.sources || []) {
  const url = `https://api.github.com/repos/${item.repo}/contents/${item.path}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    next[item.id] = {
      repo: item.repo,
      path: item.path,
      sha: data.sha || "",
      state: "ok"
    };
  } catch (e) {
    next[item.id] = {
      repo: item.repo,
      path: item.path,
      sha: oldStatus.sources?.[item.id]?.sha || "",
      state: "error"
    };
  }
  const before = oldStatus.sources?.[item.id]?.sha;
  if (before && next[item.id].sha && before !== next[item.id].sha) {
    console.log(`CHANGED: ${item.id} ${before.slice(0,7)} -> ${next[item.id].sha.slice(0,7)}`);
  } else {
    console.log(`${item.id}: ${next[item.id].state}`);
  }
}

const before = JSON.stringify(oldStatus.sources || {});
const after = JSON.stringify(next);
const status = {
  schemaVersion: 1,
  generation: before === after ? Number(oldStatus.generation || 0) : Number(oldStatus.generation || 0) + 1,
  sources: next
};
const changed = await writeJsonIfChanged("upstreams/status.json", status);
console.log(changed ? "upstreams/status.json updated" : "upstreams/status.json unchanged");
