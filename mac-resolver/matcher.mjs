export function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.name === "string") return value.name;
  try {
    const s = String(value);
    return s === "[object Object]" ? "" : s;
  } catch {
    return "";
  }
}

export function normalize(value) {
  return textValue(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\[\]【】()（）<>《》]/g, " ")
    .replace(/[\s\-_.·•,:：'\"“”‘’/\\]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseDuration(value) {
  if (Number.isFinite(Number(value)) && String(value).trim() !== "") return Number(value);
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function overlapRatio(a, b) {
  if (!a || !b) return 0;
  const aa = [...new Set(a)];
  let hits = 0;
  for (const ch of aa) if (b.includes(ch)) hits += 1;
  return hits / Math.max(1, aa.length);
}

function hasUnwantedVariant(candidateTitle, requestedTitle) {
  const raw = String(candidateTitle || "").toLowerCase();
  const requested = String(requestedTitle || "").toLowerCase();
  const terms = [
    "live", "cover", "karaoke", "instrumental", "remix", "nightcore",
    "sped up", "slowed", "reaction", "翻唱", "伴奏", "纯音乐", "现场版"
  ];
  return terms.some((term) => raw.includes(term) && !requested.includes(term));
}

export function toCandidate(item) {
  return {
    videoId: String(item?.video_id || item?.videoId || item?.id || ""),
    title: textValue(item?.title),
    artist: textValue(item?.author?.name || item?.author || item?.channel_name),
    duration: Number(item?.duration?.seconds || item?.duration || 0),
    raw: item,
  };
}

export function scoreCandidate(item, request) {
  const candidate = toCandidate(item);
  const wantedTitle = normalize(request?.name || request?.title);
  const wantedArtist = normalize(request?.singer || request?.artist);
  const title = normalize(candidate.title);
  const artist = normalize(candidate.artist);

  if (!candidate.videoId || !wantedTitle || !title) return -999;

  let score = 0;
  if (title === wantedTitle) score += 75;
  else if (title.includes(wantedTitle)) score += 62;
  else if (wantedTitle.includes(title)) score += 42;
  else score += Math.round(38 * overlapRatio(wantedTitle, title));

  if (wantedArtist) {
    if (title.includes(wantedArtist)) score += 30;
    if (artist.includes(wantedArtist)) score += 28;
    if (!title.includes(wantedArtist) && !artist.includes(wantedArtist)) score -= 10;
  }

  const targetDuration = parseDuration(request?.duration);
  const candidateDuration = parseDuration(candidate.duration);
  if (targetDuration && candidateDuration) {
    const diff = Math.abs(targetDuration - candidateDuration);
    if (diff <= 3) score += 30;
    else if (diff <= 8) score += 24;
    else if (diff <= 15) score += 16;
    else if (diff <= 30) score += 7;
    else score -= Math.min(40, Math.round((diff - 30) / 2));
  }

  if (hasUnwantedVariant(candidate.title, request?.name || request?.title)) score -= 35;
  return score;
}

export function rankCandidates(items, request) {
  return (items || [])
    .map((item) => ({ ...toCandidate(item), score: scoreCandidate(item, request) }))
    .filter((item) => item.videoId && item.score > -900)
    .sort((a, b) => b.score - a.score);
}
