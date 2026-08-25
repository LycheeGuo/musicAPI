import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration, rankCandidates, scoreCandidate } from "./matcher.mjs";

test("parse duration", () => {
  assert.equal(parseDuration("4:30"), 270);
  assert.equal(parseDuration("1:02:03"), 3723);
});

test("prefers matching title artist and duration", () => {
  const request = { name: "简单爱", singer: "周杰伦", duration: "4:30" };
  const good = {
    type: "Video",
    video_id: "goodVideo01",
    title: { text: "周杰伦 Jay Chou【简单爱 Simple Love】" },
    author: { name: "周杰伦 Jay Chou" },
    duration: { seconds: 270 },
  };
  const cover = {
    type: "Video",
    video_id: "coverVideo1",
    title: { text: "简单爱 Cover 翻唱" },
    author: { name: "Some Singer" },
    duration: { seconds: 272 },
  };
  assert.ok(scoreCandidate(good, request) > scoreCandidate(cover, request));
  assert.equal(rankCandidates([cover, good], request)[0].videoId, "goodVideo01");
});
