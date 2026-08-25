import test from "node:test";
import assert from "node:assert/strict";
import { durationSeconds, rankCandidates, scoreCandidate } from "./matcher.mjs";

test("durationSeconds supports seconds, milliseconds, and mm:ss", () => {
  assert.equal(durationSeconds(270), 270);
  assert.equal(durationSeconds(270000), 270);
  assert.equal(durationSeconds("4:30"), 270);
});

test("original-looking result outranks cover and live versions", () => {
  const target = { name: "简单爱", singer: "周杰伦", duration: 270 };
  const ranked = rankCandidates([
    { videoId: "aaaaaaaaaaa", title: "简单爱 - Cover 翻唱", author: "Random Singer", duration: 269 },
    { videoId: "bbbbbbbbbbb", title: "周杰伦 简单爱 Live 现场版", author: "Fan Channel", duration: 282, isLive: true },
    { videoId: "ccccccccccc", title: "周杰伦 - 简单爱 Official Audio", author: "周杰伦", duration: 270 },
  ], target);

  assert.equal(ranked[0].videoId, "ccccccccccc");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("missing artist is penalized when target artist is known", () => {
  const target = { name: "白色风车", singer: "周杰伦", duration: 263 };
  const correct = scoreCandidate({ title: "周杰伦 白色风车", author: "周杰伦", duration: 263 }, target);
  const wrong = scoreCandidate({ title: "白色风车", author: "Other Artist", duration: 263 }, target);
  assert.ok(correct > wrong);
});
