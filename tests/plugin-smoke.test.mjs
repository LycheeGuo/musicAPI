import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadPlugin(requestImpl) {
  const code = await fs.readFile("dist/splayer-source.js", "utf8");
  let registered;
  const handlers = {};
  const splayer = {
    register(value) { registered = value; },
    on(name, fn) { handlers[name] = fn; },
    request: requestImpl,
    log: { info() {}, warn() {}, error() {} },
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
  return { registered, handlers };
}

test("built plugin registers wy/tx/kg and musicUrl", async () => {
  const { registered, handlers } = await loadPlugin(async () => ({ status: 500, headers: {}, body: {} }));
  assert.ok(registered?.sources?.wy);
  assert.ok(registered?.sources?.tx);
  assert.ok(registered?.sources?.kg);
  assert.equal(typeof handlers.musicUrl, "function");
});

test("lossless failure falls back to hq and result is cached", async () => {
  const providerCalls = [];
  const { handlers } = await loadPlugin(async (url) => {
    if (url.includes("raw.githubusercontent.com")) return { status: 500, headers: {}, body: {} };
    if (url.includes("music-api.gdstudio.xyz")) {
      providerCalls.push(url);
      if (url.includes("br=740")) return { status: 200, headers: {}, body: {} };
      if (url.includes("br=320")) return { status: 200, headers: {}, body: { url: "https://media.example.test/song.mp3" } };
    }
    return { status: 500, headers: {}, body: {} };
  });

  const req = {
    source: "wy",
    quality: "lossless",
    musicInfo: { songmid: "123", name: "Test Song", singer: "Test Artist" },
  };

  const first = await handlers.musicUrl(req);
  assert.equal(first.url, "https://media.example.test/song.mp3");
  assert.equal(first.quality, "hq");
  assert.equal(providerCalls.length, 2);
  assert.ok(providerCalls[0].includes("br=740"));
  assert.ok(providerCalls[1].includes("br=320"));

  const second = await handlers.musicUrl(req);
  assert.equal(second.url, first.url);
  assert.equal(second.quality, "hq");
  assert.equal(providerCalls.length, 2);
});

test("all primary providers failing triggers Kuwo match and cross-provider resolve", async () => {
  let kuwoSearchCalls = 0;
  let miguSearchCalls = 0;
  let crossResolveCalls = 0;

  const { handlers } = await loadPlugin(async (url) => {
    if (url.includes("raw.githubusercontent.com")) return { status: 500, headers: {}, body: {} };

    if (url.includes("search.kuwo.cn/r.s")) {
      kuwoSearchCalls += 1;
      return {
        status: 200,
        headers: {},
        body: {
          abslist: [
            {
              MUSICRID: "MUSIC_456",
              NAME: "Cross Song",
              ARTIST: "Cross Artist",
              DURATION: "240",
            },
          ],
        },
      };
    }

    if (url.includes("m.music.migu.cn/migu/remoting/scr_search_tag")) {
      miguSearchCalls += 1;
      return { status: 200, headers: {}, body: { musics: [] } };
    }

    if (url.includes("lc.guoyue2010.top") && url.includes("source=kw") && url.includes("songId=456")) {
      crossResolveCalls += 1;
      return {
        status: 200,
        headers: {},
        body: { code: 200, url: "https://media.example.test/cross-song.flac" },
      };
    }

    if (url.includes("music-api.gdstudio.xyz")) return { status: 200, headers: {}, body: {} };
    if (url.includes("lxmusicapi.onrender.com")) return { status: 200, headers: {}, body: { code: 500 } };
    if (url.includes("api.music.lerd.dpdns.org")) return { status: 200, headers: {}, body: { code: 500 } };
    if (url.includes("lc.guoyue2010.top")) return { status: 200, headers: {}, body: { code: 500 } };
    if (url.includes("source.shiqianjiang.cn")) return { status: 200, headers: {}, body: { code: 500 } };
    if (url.includes("api.ikunshare.com")) return { status: 200, headers: {}, body: { code: 500 } };
    return { status: 500, headers: {}, body: {} };
  });

  const result = await handlers.musicUrl({
    source: "wy",
    quality: "lossless",
    musicInfo: {
      songmid: "original-123",
      name: "Cross Song",
      singer: "Cross Artist",
      interval: "04:00",
    },
  });

  assert.equal(result.url, "https://media.example.test/cross-song.flac");
  assert.equal(result.quality, "lossless");
  assert.equal(kuwoSearchCalls, 1);
  assert.equal(miguSearchCalls, 1);
  assert.equal(crossResolveCalls, 1);
});
