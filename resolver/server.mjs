import http from "node:http";
import { Readable } from "node:stream";
import { findBestVideo, getAudioStreamUrl } from "./youtube.mjs";
import { normalizeText } from "./matcher.mjs";

const PORT = Number(process.env.PORT || 8000);
const MIN_SCORE = Number(process.env.MIN_MATCH_SCORE || 45);
const MATCH_CACHE_MS = Number(process.env.MATCH_CACHE_MS || 6 * 60 * 60 * 1000);
const RESOLVE_LIMIT_PER_MINUTE = Number(process.env.RESOLVE_LIMIT_PER_MINUTE || 30);
const STREAM_LIMIT_PER_MINUTE = Number(process.env.STREAM_LIMIT_PER_MINUTE || 180);

const matchCache = new Map();
const rateBuckets = new Map();

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function rateAllowed(req, kind) {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${kind}:${clientIp(req)}:${minute}`;
  const limit = kind === "stream" ? STREAM_LIMIT_PER_MINUTE : RESOLVE_LIMIT_PER_MINUTE;
  const next = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, next);

  if (rateBuckets.size > 5000) {
    const oldestMinute = minute - 2;
    for (const entry of rateBuckets.keys()) {
      const part = Number(entry.split(":").pop());
      if (part < oldestMinute) rateBuckets.delete(entry);
    }
  }

  return next <= limit;
}

function cacheKey(name, singer, duration) {
  return `${normalizeText(name)}|${normalizeText(singer)}|${String(duration || "")}`;
}

function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) throw new Error("missing public host");
  return `${proto}://${host}`;
}

async function resolveTrack(req, res, url) {
  if (!rateAllowed(req, "resolve")) return json(res, 429, { code: 429, message: "rate limit" });

  const name = String(url.searchParams.get("name") || "").trim().slice(0, 200);
  const singer = String(url.searchParams.get("singer") || "").trim().slice(0, 200);
  const duration = String(url.searchParams.get("duration") || "").trim().slice(0, 20);
  const quality = String(url.searchParams.get("quality") || "hq").trim().slice(0, 20);

  if (!name) return json(res, 400, { code: 400, message: "name is required" });

  const key = cacheKey(name, singer, duration);
  let resolved = matchCache.get(key);
  if (!resolved || Date.now() - resolved.at > MATCH_CACHE_MS) {
    const result = await findBestVideo({ name, singer, duration, minScore: MIN_SCORE });
    resolved = { at: Date.now(), ...result.best };
    matchCache.set(key, resolved);
  }

  // Resolve once here as a playability check and to warm the short-lived stream cache.
  await getAudioStreamUrl(resolved.videoId);

  const origin = publicOrigin(req);
  const streamUrl = `${origin}/stream/${encodeURIComponent(resolved.videoId)}?quality=${encodeURIComponent(quality)}`;

  return json(res, 200, {
    code: 0,
    source: "youtube",
    url: streamUrl,
    videoId: resolved.videoId,
    title: resolved.title,
    author: resolved.author,
    duration: resolved.duration,
    score: resolved.score,
  });
}

async function proxyStream(req, res, videoId) {
  if (!rateAllowed(req, "stream")) return json(res, 429, { code: 429, message: "rate limit" });
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return json(res, 400, { code: 400, message: "invalid video id" });

  const { url } = await getAudioStreamUrl(videoId);
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Accept: "*/*",
  };
  if (req.headers.range) headers.Range = String(req.headers.range);

  let upstream = await fetch(url, { method: "GET", headers, redirect: "follow" });

  // A signed URL may occasionally expire between resolve and first byte. Refresh once.
  if (upstream.status === 403 || upstream.status === 410) {
    const fresh = await getAudioStreamUrl(videoId);
    upstream = await fetch(fresh.url, { method: "GET", headers, redirect: "follow" });
  }

  if (!upstream.ok && upstream.status !== 206) {
    throw new Error(`youtube upstream HTTP ${upstream.status}`);
  }

  const forwardHeaders = {};
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const value = upstream.headers.get(key);
    if (value) forwardHeaders[key] = value;
  }
  forwardHeaders["cache-control"] = "private, max-age=60";
  forwardHeaders["x-content-type-options"] = "nosniff";

  res.writeHead(upstream.status, forwardHeaders);
  if (!upstream.body) return res.end();

  const nodeStream = Readable.fromWeb(upstream.body);
  req.on("aborted", () => nodeStream.destroy());
  nodeStream.on("error", () => {
    if (!res.destroyed) res.destroy();
  });
  nodeStream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "splayer-koyeb-youtube-resolver" });
    }

    if (req.method === "GET" && url.pathname === "/resolve") {
      return await resolveTrack(req, res, url);
    }

    const streamMatch = req.method === "GET" ? url.pathname.match(/^\/stream\/([A-Za-z0-9_-]{6,20})$/) : null;
    if (streamMatch) return await proxyStream(req, res, streamMatch[1]);

    return json(res, 404, { code: 404, message: "not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return json(res, 502, { code: 502, message: String(error?.message || error) });
    res.destroy();
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`resolver listening on 0.0.0.0:${PORT}`);
});
