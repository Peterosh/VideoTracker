"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const EpisodeDiscovery = require("../episode-discovery.js");

test("extracts the latest episode from visible update text", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(`
    <main>
      <h1>示例动画</h1>
      <p>已更新至第 18 集</p>
      <a>第 17 集</a>
      <a>第 18 集</a>
    </main>
  `);

  assert.equal(result.number, 18);
  assert.equal(result.label, "第 18 集");
});

test("extracts structured episode fields without treating years as episodes", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(`
    <script>
      window.__SHOW__ = {
        "copyright": "2026",
        "currentEpisode": 7,
        "episodeNumber": 26
      };
    </script>
  `);

  assert.equal(result.number, 26);
  assert.equal(result.source, "structured");
});

test("extracts episode numbers from player URLs", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(`
    <div data-url="/anime/01b4/play/1/108.html"></div>
    <div data-url="/anime/01b4/play/1/109.html"></div>
  `);

  assert.equal(result.number, 109);
  assert.equal(result.source, "url");
});

test("extracts preview episodes marked with 先行", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(`
    <a href="/anime/01b4/play/1/104.html" data-num="104">先行104集</a>
  `);

  assert.equal(result.number, 104);
  assert.equal(result.label, "第 104 集");
});

test("prefers the tracked show playlist over recommendation update text", () => {
  const currentUrl =
    "https://cn.211dm.com/anime/01b4f32464ea949eafbcaed8/play/1/103.html";
  const result = EpisodeDiscovery.extractLatestEpisode(
    `
      <section class="recommendations">
        <a href="/anime/other.html">
          <h4>沧元图2024</h4>
          <span>更新至43集</span>
        </a>
      </section>
      <ul class="play-list">
        <li>
          <a href="/anime/01b4f32464ea949eafbcaed8/play/1/103.html"
             title="103集" data-num="103">103集</a>
        </li>
        <li>
          <a href="/anime/01b4f32464ea949eafbcaed8/play/1/104.html"
             title="先行104集" data-num="104">先行104集</a>
        </li>
      </ul>
    `,
    { currentUrl }
  );

  assert.equal(result.number, 104);
  assert.equal(result.label, "第 104 集");
  assert.equal(result.source, "url");
});

test("prefers explicit update text over higher recommendation links", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(
    `
      <h1>示例动画</h1>
      <p>更新至第 8 集</p>
      <a href="/recommend/other-show/episode-99.html">其他剧 第 99 集</a>
    `,
    {
      currentUrl: "https://video.example.com/show/example/episode-3.html"
    }
  );

  assert.equal(result.number, 8);
  assert.equal(result.source, "latest-range");
});

test("only compares episode links from the tracked show URL", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(
    `
      <a href="/show/example/episode-12.html">第 12 集</a>
      <a href="/show/other/episode-40.html">第 40 集</a>
      <a href="/show/example/episode-13.html">第 13 集</a>
    `,
    {
      currentUrl: "https://video.example.com/show/example/episode-3.html"
    }
  );

  assert.equal(result.number, 13);
  assert.equal(result.source, "url");
});

test("decodes escaped unicode before extracting an episode", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(
    String.raw`<p>\u66f4\u65b0\u81f3\u7b2c 32 \u96c6</p>`
  );

  assert.equal(result.number, 32);
});

test("returns null when a page has no episode information", () => {
  const result = EpisodeDiscovery.extractLatestEpisode(
    "<html><body><h1>No episode metadata</h1></body></html>"
  );

  assert.equal(result, null);
});
