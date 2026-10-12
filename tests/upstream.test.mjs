import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadSource, syncUpstreams, validateWatch } from "../scripts/upstream-watch.mjs";
import { adaptHuibq, huibqTransportUrl } from "../scripts/adapters/huibq.mjs";
import { validateProviderConfig } from "../scripts/lib.mjs";

const item = { id: "test-source", repo: "owner/repo", path: "src/latest.js" };
const watch = { schemaVersion: 1, sources: [item] };
function response(code = "globalThis.lx; throw new Error('must never execute')", overrides = {}) {
  const bytes = Buffer.from(code);
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return new Response(JSON.stringify({ type: "file", sha, encoding: "base64", size: bytes.length, content: bytes.toString("base64"), ...overrides }));
}

test("watch rejects duplicate ids and path traversal", () => {
  assert.throws(() => validateWatch({ ...watch, sources: [item, item] }));
  assert.throws(() => validateWatch({ ...watch, sources: [{ ...item, path: "../latest.js" }] }));
});
test("downloads actual bytes, verifies blob and does not execute source", async () => {
  let url, options;
  const result = await downloadSource(item, async (u, o) => { url = u; options = o; return response(); }, "fixture-token");
  assert.match(url, /^https:\/\/api.github.com\/repos\/owner\/repo\/contents\//);
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.match(result.code, /must never execute/);
  assert.equal(result.sha256.length, 64);
});
test("rejects integrity mismatch, directories, empty SHA and oversized files", async () => {
  for (const bad of [{ sha: "a".repeat(40) }, { type: "dir" }, { sha: "" }, { size: 1000001 }]) {
    await assert.rejects(downloadSource(item, async () => response(undefined, bad)));
  }
});
test("retries transient errors but not forbidden/missing files", async () => {
  let calls = 0;
  await downloadSource(item, async () => ++calls === 1 ? new Response("", { status: 503 }) : response());
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(downloadSource(item, async () => { calls++; return new Response("", { status: 403 }); }), /HTTP 403/);
  assert.equal(calls, 1);
});
test("failed source produces errors and leaves input status/config untouched", async () => {
  const status = { schemaVersion: 1, generation: 3, sources: { old: { sha: "previous" } } };
  const config = { schemaVersion: 1, revision: 1, providers: [] };
  const before = JSON.stringify({ status, config });
  const result = await syncUpstreams(watch, status, config, async () => new Response("", { status: 404 }));
  assert.equal(result.errors.length, 1);
  assert.equal(JSON.stringify({ status, config }), before);
});
test("unknown sources are quarantined; second identical sync preserves generation", async () => {
  const config = { schemaVersion: 1, revision: 1, providers: [] };
  const first = await syncUpstreams(watch, { generation: 0, sources: {} }, config, async () => response());
  assert.equal(first.status.sources[item.id].integration, "review-required");
  assert.deepEqual(first.config, config);
  const second = await syncUpstreams(watch, first.status, first.config, async () => response());
  assert.deepEqual(second.status, first.status);
  assert.equal(second.report[0].changed, false);
});
test("Huibq restricts complete code shape and endpoint trust boundary", () => {
  const fixture = "const API_URL = 'https://lxmusicapi.onrender.com/v2'\n// local synthetic protocol fixture";
  const provider = { transport: { method: "GET" } };
  assert.equal(huibqTransportUrl("https://lxmusicapi.onrender.com/v2"), "https://lxmusicapi.onrender.com/v2/url/{source}/{hash}/{quality}");
  assert.throws(() => adaptHuibq(fixture, provider), /code shape changed/);
  assert.throws(() => adaptHuibq(fixture + "\neval('bad')", provider), /code shape changed/);
  for (const url of ["http://lxmusicapi.onrender.com", "https://evil.test", "https://user:password@lxmusicapi.onrender.com", "https://lxmusicapi.onrender.com/?token=secret"]) {
    assert.throws(() => huibqTransportUrl(url), /outside reviewed origin/);
  }
});
test("malformed providers produce validation errors instead of crashing", () => {
  assert.ok(validateProviderConfig({ schemaVersion: 1, providers: {} }).errors.length);
});
