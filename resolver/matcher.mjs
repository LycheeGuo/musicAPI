const NEGATIVE_TERMS = [
  "cover", "翻唱", "karaoke", "伴奏", "instrumental", "reaction", "教学", "tutorial",
  "remix", "nightcore", "spedup", "sped up", "slowed", "reverb", "8d", "live", "现场"
];

const POSITIVE_TERMS = ["official audio", "official mv", "official video", "官方", "topic"];

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\[\]【】()（）]/g, " ")
    .replace(/[\s\-_.·•,:：'\"“”‘’/\\]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function durationSeconds(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n > 10000 ? Math.round(n / 1000) : n;

  const parts = String(value).trim().split(":").map(Number);
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return 0;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

function charSimilarity(a, b) {
  const aa = [...new Set(normalizeText(a))];
  const bb = new Set(normalizeText(b));
  if (!aa.length || !bb.size) return 0;
  let hit = 0;
  for (const ch of aa) if (bb.has(ch)) hit += 1;
  return hit / aa.length;
}

export function scoreCandidate(candidate, target) {
  const wantedTitle = normalizeText(target?.name);
  const wantedArtist = normalizeText(target?.singer);
  const title = normalizeText(candidate?.title);
  const author = normalizeText(candidate?.author);
  const rawTitle = String(candidate?.title || "").toLowerCase();

  if (!wantedTitle || !title) return -999;

  let score = 0;

  if (title.includes(wantedTitle)) score += 60;
  else if (wantedTitle.includes(title)) score += 38;
  else score += Math.round(charSimilarity(wantedTitle, title) * 35);

  if (wantedArtist) {
    if (title.includes(wantedArtist)) score += 28;
    if (author.includes(wantedArtist)) score += 24;
    if (!title.includes(wantedArtist) && !author.includes(wantedArtist)) score -= 12;
  }

  const targetDuration = durationSeconds(target?.duration);
  const candidateDuration = durationSeconds(candidate?.duration);
  if (targetDuration && candidateDuration) {
    const diff = Math.abs(targetDuration - candidateDuration);
    if (diff <= 4) score += 28;
    else if (diff <= 8) score += 22;
    else if (diff <= 15) score += 15;
    else if (diff <= 30) score += 6;
    else if (diff > 60) score -= 35;
    else score -= 12;
  }

  const targetRaw = `${target?.name || ""} ${target?.singer || ""}`.toLowerCase();
  for (const term of POSITIVE_TERMS) {
    if (rawTitle.includes(term)) score += 7;
  }
  for (const term of NEGATIVE_TERMS) {
    if (rawTitle.includes(term) && !targetRaw.includes(term)) score -= 22;
  }

  if (candidate?.isLive && !targetRaw.includes("live") && !targetRaw.includes("现场")) score -= 30;

  return score;
}

export function rankCandidates(candidates, target) {
  return (candidates || [])
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, target) }))
    .filter((candidate) => candidate.score > -900)
    .sort((a, b) => b.score - a.score);
}
