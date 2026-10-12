import { createHash } from "node:crypto";

// Reviewed LX v1.2.0: only API_URL may vary; no remote JS is evaluated.
export const REVIEWED_SHAPE = "91f7106cdde45ac444339135d61dda76d743db2d66e46d19487e0baf5948895b";
export function adaptHuibq(code, provider) {
  const pattern = /const API_URL = '([^'\n]+)'/g;
  const matches = [...code.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("Huibq API_URL declaration changed");
  const normalized = code.replace(pattern, "const API_URL = __REVIEWED_URL__");
  if (createHash("sha256").update(normalized).digest("hex") !== REVIEWED_SHAPE) {
    throw new Error("Huibq code shape changed; manual interface review required");
  }
  return { ...provider, transport: { ...provider.transport, url: huibqTransportUrl(matches[0][1]) } };
}

export function huibqTransportUrl(apiUrl) {
  const origin = new URL(apiUrl);
  if (origin.protocol !== "https:" || origin.hostname !== "lxmusicapi.onrender.com" ||
      origin.port || origin.username || origin.password || origin.search || origin.hash || !/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(origin.pathname)) {
    throw new Error("Huibq endpoint outside reviewed origin; manual domain review required");
  }
  return `${origin.origin}${origin.pathname.replace(/\/$/, "")}/url/{source}/{hash}/{quality}`;
}
