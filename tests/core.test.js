"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("extracts common Chinese and international episode labels", () => {
  assert.equal(Core.extractEpisodeLabel("庆余年 第12集 - 腾讯视频"), "第 12 集");
  assert.equal(Core.extractEpisodeLabel("甄嬛传 第十二话"), "第 十二 话");
  assert.equal(Core.extractEpisodeLabel("Stranger Things S04E07"), "S04E07");
  assert.equal(Core.extractEpisodeLabel("Episode 8 - The Finale"), "EP 8");
  assert.equal(Core.extractEpisodeLabel("沧元图 101集-Omofun动漫"), "第 101 集");
  assert.equal(Core.extractEpisodeLabel("沧元图 先行104集-Omofun动漫"), "第 104 集");
  assert.equal(Core.extractEpisodeLabel("沧元图 先行 105 集"), "第 105 集");
  assert.equal(Core.extractEpisodeLabel("没有集数"), "");
});

test("parses episode numbers for regression guards", () => {
  assert.equal(Core.parseEpisodeNumber("第 101 集"), 101);
  assert.equal(Core.parseEpisodeNumber("第一百零一集"), 101);
  assert.equal(Core.parseEpisodeNumber("S04E07"), 7);
  assert.equal(Core.parseEpisodeNumber("EP 12"), 12);
  assert.equal(Core.parseEpisodeNumber("沧元图 先行104集"), 104);
  assert.equal(Core.parseEpisodeNumber("沧元图 先行 105 集"), 105);
  assert.equal(Core.parseEpisodeNumber("没有集数"), null);
});

test("cleans site titles but keeps the drama name", () => {
  assert.equal(
    Core.cleanSeriesTitle("庆余年 第二季 第12集 - 腾讯视频"),
    "庆余年 第二季"
  );
  assert.equal(
    Core.cleanSeriesTitle("漫长的季节 第03集_哔哩哔哩_bilibili"),
    "漫长的季节"
  );
  assert.equal(Core.cleanSeriesTitle("Episode 3"), "Episode 3");
  assert.equal(Core.cleanSeriesTitle("沧元图 101集-Omofun动漫"), "沧元图");
  assert.equal(Core.cleanSeriesTitle("沧元图 先行104集-Omofun动漫"), "沧元图");
});

test("derives stable adapter series keys", () => {
  const first = Core.deriveSeriesKey(
    "https://v.qq.com/x/cover/abc123/episode-one.html",
    "庆余年 第1集"
  );
  const second = Core.deriveSeriesKey(
    "https://v.qq.com/x/cover/abc123/episode-two.html",
    "庆余年 第2集"
  );
  assert.equal(first, "tencent:cover:abc123");
  assert.equal(second, first);

  assert.equal(
    Core.deriveSeriesKey(
      "https://cn.211dm.com/anime/01b4f32464ea949eafbcaed8/play/1/101.html",
      "沧元图 101集-Omofun动漫"
    ),
    "omofun:anime:01b4f32464ea949eafbcaed8"
  );
});

test("creates deterministic compact show identifiers", () => {
  assert.equal(Core.createShowId("tencent:cover:abc123"), Core.createShowId("tencent:cover:abc123"));
  assert.notEqual(Core.createShowId("tencent:cover:abc123"), Core.createShowId("iqiyi:other"));
  assert.match(Core.createShowId("tencent:cover:abc123"), /^show_[a-z0-9]+$/);
});

test("formats watched time and progress", () => {
  assert.equal(Core.formatTime(65), "1:05");
  assert.equal(Core.formatTime(3661), "1:01:01");
  assert.equal(Core.calculateProgress(900, 3600), 25);
  assert.equal(Core.calculateProgress(4000, 3600), 100);
  assert.equal(Core.calculateProgress(20, 0), 0);
});

test("formats recent timestamps for the record list", () => {
  const now = new Date("2026-11-18T10:00:00+08:00").getTime();
  assert.equal(Core.formatRelativeTime(now - 20 * 1000, now), "刚刚");
  assert.equal(Core.formatRelativeTime(now - 12 * 60 * 1000, now), "12 分钟前");
  assert.equal(Core.formatRelativeTime(now - 3 * 60 * 60 * 1000, now), "3 小时前");
  assert.equal(Core.formatRelativeTime(now - 24 * 60 * 60 * 1000, now), "昨天");
});

test("recognizes common Chinese video hosts", () => {
  assert.equal(Core.getSite("https://v.qq.com/x/cover/abc.html").id, "tencent");
  assert.equal(Core.getSite("https://www.bilibili.com/bangumi/play/ep1").id, "bilibili");
  assert.equal(Core.getSite("https://cn.211dm.com/anime/test.html").id, "omofun");
  assert.equal(Core.getSite("https://example.com/watch").id, "generic");
});
