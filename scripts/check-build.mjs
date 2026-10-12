import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const before = await fs.readFile("dist/splayer-source.js");
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
assert.deepEqual(await fs.readFile("dist/splayer-source.js"), before, "Repeated build changed plugin/version");
console.log("Repeated build is byte-identical");
