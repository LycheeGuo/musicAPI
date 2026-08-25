import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

test("built LX plugin initializes and falls back between providers", async () => {
  const code = await fs.readFile("dist/lx-source.js", "utf8");
  const handlers = {};
  const sent = [];
  const requests = [];

  const lx = {
    version: "2.11.0",
    EVENT_NAMES: {
      request: "request",
      inited: "inited",
      updateAlert: "updateAlert",
    },
    on(name, fn) {
      handlers[name] = fn;
    },
    send(name, payload) {
      sent.push({ name, payload });
    },
    request(url, options, callback) {
      requests.push({ url, options });

      if (url.includes("raw.githubusercontent.com")) {
        callback(null, { statusCode: 200, body: "@version 1.0.0" });
        return;
      }

      if (url.includes("music-api.gdstudio.xyz")) {
        callback(null, { statusCode: 500, body: {} });
        return;
      }

      if (url.includes("lxmusicapi.onrender.com")) {
        callback(null, {
          statusCode: 200,
          body: { code: 0, url: "https://media.example.test/song.mp3" },
        });
        return;
      }

      callback(new Error(`unexpected request ${url}`));
    },
  };

  const context = vm.createContext({
    lx,
    console: { log() {}, warn() {}, error() {} },
    Promise,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    encodeURIComponent,
  });

  new vm.Script(code, { filename: "lx-source.js" }).runInContext(context, { timeout: 1000 });

  const inited = sent.find((entry) => entry.name === "inited");
  assert.equal(inited?.payload?.status, true);
  assert.ok(inited?.payload?.sources?.wy);
  assert.ok(inited?.payload?.sources?.tx);
  assert.ok(inited?.payload?.sources?.kg);
  assert.equal(typeof handlers.request, "function");

  const url = await handlers.request({
    action: "musicUrl",
    source: "wy",
    info: {
      type: "320k",
      musicInfo: {
        songmid: "123456",
        name: "Test Song",
        singer: "Test Artist",
        interval: 240,
      },
    },
  });

  assert.equal(url, "https://media.example.test/song.mp3");
  assert.ok(requests.some((item) => item.url.includes("music-api.gdstudio.xyz")));
  assert.ok(requests.some((item) => item.url.includes("lxmusicapi.onrender.com")));
});
