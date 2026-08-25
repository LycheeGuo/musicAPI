import http from "node:http";
import { Innertube, UniversalCache } from "youtubei.js";
import { rankCandidates } from "./matcher.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 9863);
const VERSION = "1.0.0";
const MIN_SCORE = 42;
const SEARCH_LIMIT = 10;
const RESOLVE_LIMIT = 5;

let ytPromise;

function getYouTube() {
  if (!ytPromise) {
    ytPromise = Innertube.create({
      cache: new UniversalCache(true),
      generate_session_locally: true,
    }).catch((error) => {
      ytPromise = undefined;
      throw error;
    });
  }
  return ytPromise;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function expireFromMediaUrl(mediaUrl) {
  try {
    const value = new URL(mediaUrl).searchParams.get("expire");
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function cleanError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 500 ? message.slice(0, 500) : message;
}

async function resolveTrack(params) {
  const name = String(params.name || params.title || "").trim();
  const singer = String(params.singer || params.artist || "").trim();
  const duration = String(params.duration || "").trim();
  if (!name) throw new Error("missing song name");

  const yt = await getYouTube();
  const query = [name, singer].filter(Boolean).join(" ");
  const search = await yt.search(query, { type: "video" });
  const ranked = rankCandidates(Array.from(search.results || []).slice(0, SEARCH_LIMIT), {
    name,
    singer,
    duration,
  });

  if (!ranked.length) throw new Error("YouTube search returned no video candidates");
  if (ranked[0].score < MIN_SCORE) {
    throw new Error(`best YouTube match score too low: ${ranked[0].score}`);
  }

  const errors = [];
  for (const candidate of ranked.slice(0, RESOLVE_LIMIT)) {
    if (candidate.score < MIN_SCORE) break;
    try {
      const format = await yt.getStreamingData(candidate.videoId, {
        type: "audio",
        quality: "best",
        format: "any",
      });
      const mediaUrl = String(format?.url || "").trim();
      if (!/^https?:\/\//i.test(mediaUrl)) throw new Error("no audio URL returned");

      return {
        ok: true,
        url: mediaUrl,
        expire: expireFromMediaUrl(mediaUrl),
        videoId: candidate.videoId,
        matchedTitle: candidate.title,
        matchedArtist: candidate.artist,
        matchedDuration: candidate.duration,
        score: candidate.score,
        query,
      };
    } catch (error) {
      errors.push(`${candidate.videoId}: ${cleanError(error)}`);
    }
  }

  throw new Error(`YouTube candidates found but audio resolution failed: ${errors.join(" | ")}`);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return json(res, 400, { ok: false, error: "missing url" });
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "splayer-local-youtube-resolver",
        version: VERSION,
        host: HOST,
        port: PORT,
      });
    }

    if (url.pathname === "/resolve") {
      const started = Date.now();
      const result = await resolveTrack({
        name: url.searchParams.get("name") || url.searchParams.get("title"),
        singer: url.searchParams.get("singer") || url.searchParams.get("artist"),
        duration: url.searchParams.get("duration"),
      });
      return json(res, 200, { ...result, elapsedMs: Date.now() - started });
    }

    return json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    console.error(new Date().toISOString(), cleanError(error));
    return json(res, 502, { ok: false, error: cleanError(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SPlayer Local YouTube Resolver ${VERSION}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
