import fs from "node:fs/promises";
import { readJson, safeRepo, validateProviderConfig } from "./lib.mjs";

const template = await fs.readFile("src/plugin-template.js", "utf8");
const config = await readJson("config/providers.json");
const upstreamStatus = await readJson("upstreams/status.json");
const { errors } = validateProviderConfig(config);
if (errors.length) throw new Error("providers.json 无效:\n" + errors.join("\n"));
if (!upstreamStatus || upstreamStatus.schemaVersion !== 1 || !upstreamStatus.sources || typeof upstreamStatus.sources !== "object") {
  throw new Error("upstreams/status.json 无效");
}

const repo =
  safeRepo(process.env.GITHUB_REPOSITORY) ||
  safeRepo(process.env.REPOSITORY) ||
  "YOUR_GITHUB_USER/musicAPI";

const runNumber = String(process.env.GITHUB_RUN_NUMBER || "").trim();
const version = String(process.env.BUILD_VERSION || (runNumber ? `1.0.${runNumber}` : "1.0.0"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`BUILD_VERSION 非法: ${version}`);

const updateUrl = `https://raw.githubusercontent.com/${repo}/main/dist/splayer-source.js`;
const configUrl = `https://raw.githubusercontent.com/${repo}/main/config/providers.json`;
const runtimeUrl = `https://raw.githubusercontent.com/${repo}/main/config/runtime.json`;
const homepage = `https://github.com/${repo}`;
const author = repo.split("/")[0];
const sha = String(process.env.GITHUB_SHA || "").slice(0, 7);
const upstreamGeneration = Number(upstreamStatus.generation || 0);
const changelog = sha ? `自动构建 ${sha} · upstream gen ${upstreamGeneration}` : `初始构建 · upstream gen ${upstreamGeneration}`;

const values = {
  "__PLUGIN_VERSION__": version,
  "__UPDATE_URL__": updateUrl,
  "__CONFIG_URL__": configUrl,
  "__RUNTIME_URL__": runtimeUrl,
  "__HOMEPAGE__": homepage,
  "__AUTHOR__": author,
  "__REPOSITORY__": repo,
  "__CHANGELOG__": changelog,
  "__EMBEDDED_CONFIG__": JSON.stringify(config),
};

let out = template;
for (const [token, value] of Object.entries(values)) out = out.replaceAll(token, () => value);
const left = out.match(/__[A-Z0-9_]+__/g);
if (left?.length) throw new Error(`构建后仍存在未替换 token: ${[...new Set(left)].join(", ")}`);

const upstreamMarker = `const EMBEDDED_UPSTREAM_STATUS = ${JSON.stringify(upstreamStatus)};`;
const configMarker = "\n\nconst CONFIG_URL";
const insertAt = out.indexOf(configMarker);
if (insertAt < 0) throw new Error("无法定位 CONFIG_URL，不能嵌入 upstream status");
out = `${out.slice(0, insertAt)}\n\n${upstreamMarker}${out.slice(insertAt)}`;

await fs.mkdir("dist", { recursive: true });
await fs.writeFile("dist/splayer-source.js", out, "utf8");
console.log(`Built dist/splayer-source.js version=${version} repo=${repo} upstreamGeneration=${upstreamGeneration}`);
