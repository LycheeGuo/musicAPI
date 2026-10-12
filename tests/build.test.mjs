import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("build is deterministic, ignores watch metadata and increments only real changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "music-build-"));
  try {
    for (const dir of ["src", "scripts", "config", "dist", "upstreams"]) await fs.cp(dir, path.join(root, dir), { recursive: true });
    await fs.copyFile("package.json", path.join(root, "package.json"));
    const env = { ...process.env, GITHUB_REPOSITORY: "LycheeGuo/musicAPI", GITHUB_RUN_NUMBER: "9999", GITHUB_SHA: "different" };
    delete env.BUILD_VERSION;
    const build = () => execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, env });
    const read = () => fs.readFile(path.join(root, "dist/splayer-source.js"), "utf8");
    build(); const first = await read();
    await fs.writeFile(path.join(root, "upstreams/status.json"), "unrelated upstream metadata");
    build(); assert.equal(await read(), first);
    await fs.appendFile(path.join(root, "src/plugin-template.js"), "\n// changed engine\n");
    build(); const changed = await read();
    const versions = [first, changed].map(s => Number(s.match(/@version\s+\d+\.\d+\.(\d+)/)[1]));
    assert.equal(versions[1], versions[0] + 1);
    build(); assert.equal(await read(), changed);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("failed live-sync CLI preserves last-known-good files and saves failure report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "music-sync-"));
  try {
    for (const dir of ["scripts", "config", "upstreams"]) await fs.cp(dir, path.join(root, dir), { recursive: true });
    const files = ["upstreams/status.json", "config/providers.json"];
    const before = await Promise.all(files.map(f => fs.readFile(path.join(root, f), "utf8")));
    await fs.writeFile(path.join(root, "mock-fetch.mjs"), 'globalThis.fetch = async () => new Response("", {status: 404});');
    assert.throws(() => execFileSync(process.execPath, ["--import", "./mock-fetch.mjs", "scripts/upstream-watch.mjs"], { cwd: root, stdio: "pipe" }));
    assert.deepEqual(await Promise.all(files.map(f => fs.readFile(path.join(root, f), "utf8"))), before);
    const report = JSON.parse(await fs.readFile(path.join(root, "work/upstreams/report.json")));
    assert.equal(report.errors.length, 8);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
