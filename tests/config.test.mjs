import test from "node:test";
import assert from "node:assert/strict";
import { readJson, validateProviderConfig, bucketLatency } from "../scripts/lib.mjs";

test("providers.json validates", async () => {
  const config = await readJson("config/providers.json");
  const result = validateProviderConfig(config);
  assert.deepEqual(result.errors, []);
});

test("latency buckets", () => {
  assert.equal(bucketLatency(100), "fast");
  assert.equal(bucketLatency(900), "normal");
  assert.equal(bucketLatency(2500), "slow");
  assert.equal(bucketLatency(5000), "very-slow");
});
