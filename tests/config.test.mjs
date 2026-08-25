import test from "node:test";
import assert from "node:assert/strict";
import { readJson, validateProviderConfig, bucketLatency } from "../scripts/lib.mjs";

test("providers.json validates", async () => {
  const config = await readJson("config/providers.json");
  const result = validateProviderConfig(config);
  assert.deepEqual(result.errors, []);
});

test("multi-provider coverage", async () => {
  const config = await readJson("config/providers.json");
  const enabled = config.providers.filter((p) => p.enabled);
  assert.equal(enabled.length, 4);
  assert.ok(enabled.filter((p) => p.platforms.includes("wy")).length >= 4);
  assert.ok(enabled.filter((p) => p.platforms.includes("tx")).length >= 3);
  assert.ok(enabled.filter((p) => p.platforms.includes("kg")).length >= 3);
  assert.ok(enabled.some((p) => p.transport?.bodyMode === "lx-music-url"));
});

test("latency buckets", () => {
  assert.equal(bucketLatency(100), "fast");
  assert.equal(bucketLatency(900), "normal");
  assert.equal(bucketLatency(2500), "slow");
  assert.equal(bucketLatency(5000), "very-slow");
});
