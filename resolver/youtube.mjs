import { Innertube } from "youtubei.js";
import { rankCandidates } from "./matcher.mjs";

let clientPromise;
const streamCache = new Map();
const STREAM_CACHE_MS = 8 * 60 * 1000;

async function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toString === "function") return value.toString();
  return String(value);
}

function candidateFromNode(node) {
  const videoId = String(node?.video_id || node?.id || "");
  if (!videoId) return null;

  const duration = Number(node?.duration?.seconds || 0) || 0;
  const author = node?.author?.name || node?.author?.text || asText(node?.author);

  return {
    videoId,
    title: asText(node?.title),
    author: asText(author),
    duration,
    isLive: Boolean(node?.is_live),
  };
}

export async function findBestVideo({ name, singer, duration, minScore = 45 }) {
  const query = [name, singer].filter(Boolean).join(" ").trim();
  if (!query) throw new Error("missing search query");

  const yt = await getClient();
  const search = await yt.search(query, { type: "video" });
  const candidates = [];

  for (const node of search?.results || []) {
    const candidate = candidateFromNode(node);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= 12) break;
  }

  const ranked = rankCandidates(candidates, { name, singer, duration });
  const best = ranked[0];
  if (!best) throw new Error("youtube search returned no video candidates");
  if (best.score < Number(minScore || 45)) {
    throw new Error(`youtube candidate score too low: ${best.score}`);
  }

  return { best, ranked: ranked.slice(0, 5) };
}

export async function getAudioStreamUrl(videoId, { forceRefresh = false } = {}) {
  const cached = streamCache.get(videoId);
  if (!forceRefresh && cached && Date.now() - cached.at < STREAM_CACHE_MS) return cached.value;
  if (forceRefresh) streamCache.delete(videoId);

  const yt = await getClient();
  let lastError;
  const attempts = [
    { type: "audio", quality: "best", format: "any", codec: "mp4a" },
    { type: "audio", quality: "best", format: "any" },
  ];

  for (const options of attempts) {
    try {
      const format = await yt.getStreamingData(videoId, options);
      const url = String(format?.url || "");
      if (/^https?:\/\//i.test(url)) {
        const value = { url, itag: format?.itag || null };
        streamCache.set(videoId, { at: Date.now(), value });
        return value;
      }
      throw new Error("youtube returned no stream URL");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("youtube audio stream unavailable");
}
