import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

test("built plugin registers wy/tx/kg and musicUrl", async () => {
  const code = await fs.readFile("dist/splayer-source.js", "utf8");
  let registered;
  const handlers = {};
  const splayer = {
    register(value) { registered = value; },
    on(name, fn) { handlers[name] = fn; },
    request: async () => ({ status: 500, headers: {}, body: {} }),
    log: { info() {}, warn() {}, error() {} }
  };

  const context = vm.createContext({
    splayer,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  });

  new vm.Script(code, { filename: "splayer-source.js" }).runInContext(context, { timeout: 1000 });

  assert.ok(registered?.sources?.wy);
  assert.ok(registered?.sources?.tx);
  assert.ok(registered?.sources?.kg);
  assert.equal(typeof handlers.musicUrl, "function");
});
