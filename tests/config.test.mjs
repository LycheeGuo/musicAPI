import test from "node:test";
import assert from "node:assert/strict";
import { readJson, validateProviderConfig, bucketLatency } from "../scripts/lib.mjs";

test("providers.json validates", async () => {
  const config = await readJson("config/providers.json");
  const result = validateProviderConfig(config);
  assert.deepEqual(result.errors, []);
});

test("expanded SPlayer provider coverage", async () => {
  const config = await readJson("config/providers.json");
  const enabled = config.providers.filter((p) => p.enabled);
  assert.equal(enabled.length, 6);
  assert.ok(enabled.filter((p) => p.platforms.includes("wy")).length >= 6);
  assert.ok(enabled.filter((p) => p.platforms.includes("tx")).length >= 5);
  assert.ok(enabled.filter((p) => p.platforms.includes("kg")).length >= 5);
  assert.ok(enabled.some((p) => p.qualities?.includes("lossless")));
  assert.ok(enabled.some((p) => p.qualities?.includes("hq")));
  assert.ok(enabled.some((p) => p.transport?.bodyMode === "lx-music-url"));
});

test("quality fallback and cache defaults are enabled", async () => {
  const config = await readJson("config/providers.json");
  assert.deepEqual(config.defaults.qualityFallback, ["hi-res", "lossless", "hq", "sq", "lq"]);
  assert.ok(config.defaults.maxQualityAttemptsPerProvider >= 2);
  assert.ok(config.defaults.urlCacheTtlMs >= 60000);
});

test("Kuwo and Migu cross-platform fallback is configured", async () => {
  const config = await readJson("config/providers.json");
  assert.equal(config.crossFallback.enabled, true);
  assert.deepEqual(config.crossFallback.platforms.map((x) => x.id), ["kw", "mg"]);
  const lingchuan = config.providers.find((p) => p.id === "lingchuan-public");
  const xinlan = config.providers.find((p) => p.id === "xinlan-public");
  const ikun = config.providers.find((p) => p.id === "ikun-public");
  assert.deepEqual(lingchuan.crossPlatforms, ["kw", "mg"]);
  assert.deepEqual(xinlan.crossPlatforms, ["kw", "mg"]);
  assert.deepEqual(ikun.crossPlatforms, ["kw"]);
  assert.ok(config.crossFallback.reserveMs >= 4000);
});

test("latency buckets", () => {
  assert.equal(bucketLatency(100), "fast");
  assert.equal(bucketLatency(900), "normal");
  assert.equal(bucketLatency(2500), "slow");
  assert.equal(bucketLatency(5000), "very-slow");
});
