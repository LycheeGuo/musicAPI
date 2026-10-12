import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { readJson, safeRepo, validateProviderConfig } from "./lib.mjs";

const template = await fs.readFile("src/plugin-template.js", "utf8");
const config = await readJson("config/providers.json");
const { errors } = validateProviderConfig(config);
if (errors.length) throw new Error("providers.json invalid:\n" + errors.join("\n"));
const pkg = await readJson("package.json");
let previous = "";
try { previous = await fs.readFile("dist/splayer-source.js", "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const repo =
  safeRepo(process.env.GITHUB_REPOSITORY) ||
  safeRepo(process.env.REPOSITORY) ||
  "YOUR_GITHUB_USER/musicAPI";

const previousVersion = previous.match(/@version\s+(\d+\.\d+\.\d+)/)?.[1] || pkg.version;
const version = String(process.env.BUILD_VERSION || previousVersion);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);

const updateUrl = `https://raw.githubusercontent.com/${repo}/main/dist/splayer-source.js`;
const configUrl = `https://raw.githubusercontent.com/${repo}/main/config/providers.json`;
const runtimeUrl = `https://raw.githubusercontent.com/${repo}/main/config/runtime.json`;
const homepage = `https://github.com/${repo}`;
const author = repo.split("/")[0];
const fingerprint = createHash("sha256").update(template).update(JSON.stringify(config)).update(repo).digest("hex").slice(0, 12);
const changelog = `Verified build ${fingerprint}`;

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

if (!process.env.BUILD_VERSION && previous && out !== previous) {
  const [major, minor, patch] = previousVersion.split(".").map(Number);
  out = out.replace(`@version     ${version}`, `@version     ${major}.${minor}.${patch + 1}`);
}

await fs.mkdir("dist", { recursive: true });
await fs.writeFile("dist/splayer-source.js", out, "utf8");
console.log(out === previous ? "Plugin unchanged" : `Built dist/splayer-source.js repo=${repo}`);
