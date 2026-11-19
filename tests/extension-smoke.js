"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = path.resolve(
  process.env.EXTENSION_ROOT || projectRoot
);
const artifactsRoot = path.resolve(projectRoot, "artifacts");

function findBrowserExecutable() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createFixtureServer() {
  const videoFile = fs.readFileSync(path.join(__dirname, "fixtures", "episode.webm"));
  const pageHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta property="og:title" content="庆余年 第12集 - 腾讯视频">
    <title>庆余年 第12集 - 腾讯视频</title>
    <style>
      body { margin: 0; background: #111; }
      iframe { display: block; width: 960px; height: 540px; border: 0; }
    </style>
  </head>
  <body>
    <iframe src="/player" title="Episode player"></iframe>
  </body>
</html>`;
  const playerHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>庆余年 第12集 - Player</title>
    <style>
      body { margin: 0; background: #000; }
      video { display: block; width: 960px; height: 540px; background: #000; }
      .player-shell { position: relative; width: 960px; height: 540px; }
      .txp_ad {
        position: absolute;
        top: 12px;
        left: 12px;
        padding: 6px 10px;
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        font: 14px sans-serif;
      }
    </style>
  </head>
  <body>
    <div class="player-shell">
      <video id="fixture-video" src="/episode.webm" controls muted preload="auto"></video>
      <div id="fixture-ad" class="txp_ad" hidden>广告 10 秒</div>
    </div>
    <script>
      const video = document.getElementById("fixture-video");
      const ad = document.getElementById("fixture-ad");
      window.__fixturePlayback = {
        hideAd() {
          ad.hidden = true;
        },
        async seek(value) {
          await new Promise((resolve) => {
            video.addEventListener("seeked", resolve, { once: true });
            video.currentTime = value;
          });
        },
        pause() {
          video.pause();
        },
        showAd() {
          ad.hidden = false;
        }
      };
    </script>
  </body>
</html>`;

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === "/episode.webm") {
        const range = request.headers.range;
        const commonHeaders = {
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Type": "video/webm"
        };

        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/);
          const start = match ? Number(match[1]) : 0;
          const requestedEnd = match && match[2] ? Number(match[2]) : videoFile.length - 1;
          const end = Math.min(requestedEnd, videoFile.length - 1);
          response.writeHead(206, {
            ...commonHeaders,
            "Content-Length": end - start + 1,
            "Content-Range": `bytes ${start}-${end}/${videoFile.length}`
          });
          response.end(videoFile.subarray(start, end + 1));
          return;
        }

        response.writeHead(200, {
          ...commonHeaders,
          "Content-Length": videoFile.length
        });
        response.end(videoFile);
        return;
      }

      if (request.url === "/player") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8"
        });
        response.end(playerHtml);
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(pageHtml);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        close: () => new Promise((done) => server.close(done)),
        url: `http://127.0.0.1:${address.port}/watch/episode-12`
      });
    });
  });
}

async function sendRuntime(extensionPage, message) {
  return extensionPage.evaluate(
    (payload) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(payload, resolve);
      }),
    message
  );
}

async function main() {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactsRoot, "edge-extension-profile-"));
  const fixture = await createFixtureServer();
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: findBrowserExecutable(),
      headless: true,
      args: [
        `--disable-extensions-except=${extensionRoot}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--load-extension=${extensionRoot}`
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
    }
    assert.match(worker.url(), /^chrome-extension:\/\/[a-z]+\/background\.js$/);
    const extensionId = new URL(worker.url()).host;

    const watchPage = await context.newPage();
    await watchPage.goto(fixture.url, { waitUntil: "load" });
    const playerFrame = watchPage
      .frames()
      .find((frame) => frame.url().endsWith("/player"));
    assert.ok(playerFrame, "fixture player iframe should exist");
    await playerFrame.waitForFunction(
      () => document.querySelector("video")?.duration > 0
    );
    await playerFrame.evaluate(() => window.__fixturePlayback.seek(3));
    await watchPage.waitForTimeout(900);

    const tabs = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.tabs.query({}, (result) =>
            resolve(result.map((tab) => ({ id: tab.id, url: tab.url })))
          );
        })
    );
    const watchTab = tabs.find((tab) => tab.url && tab.url.startsWith(fixture.url));
    assert.ok(watchTab && watchTab.id, "fixture tab should be visible to the extension");

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const snapshot = await sendRuntime(extensionPage, {
      tabId: watchTab.id,
      type: "VT_GET_SNAPSHOT"
    });
    assert.equal(snapshot.title, "庆余年");
    assert.equal(snapshot.episodeLabel, "第 12 集");
    assert.equal(Math.round(snapshot.duration), 6);
    assert.equal(Math.round(snapshot.currentTime), 3);
    assert.equal(snapshot.canTrack, true);

    const startResult = await sendRuntime(extensionPage, {
      episodeLabel: snapshot.episodeLabel,
      episodeSource: "auto",
      name: snapshot.title,
      tabId: watchTab.id,
      type: "VT_START_TRACKING"
    });
    assert.equal(startResult.ok, true);
    assert.equal(startResult.record.name, "庆余年");

    await playerFrame.evaluate(() => window.__fixturePlayback.seek(4.5));
    await playerFrame.evaluate(() => window.__fixturePlayback.pause());
    await sendRuntime(extensionPage, {
      tabId: watchTab.id,
      type: "VT_SYNC_TAB"
    });

    const stored = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.sync.get(null, resolve);
        })
    );
    const recordKey = Object.keys(stored).find((key) => key.startsWith("vt.show."));
    assert.ok(recordKey, "started tracking should be written to storage.sync");
    assert.equal(stored[recordKey].position, 4.5);
    assert.equal(stored[recordKey].episodeLabel, "第 12 集");

    await playerFrame.evaluate(() => window.__fixturePlayback.showAd());
    const adSnapshot = await sendRuntime(extensionPage, {
      tabId: watchTab.id,
      type: "VT_GET_SNAPSHOT"
    });
    assert.equal(adSnapshot.adDetected, true);
    assert.equal(adSnapshot.adReason, "overlay");
    const adSync = await sendRuntime(extensionPage, {
      tabId: watchTab.id,
      type: "VT_SYNC_TAB"
    });
    assert.equal(adSync.guard, "advertisement");
    assert.equal(adSync.written, false);
    await playerFrame.evaluate(() => window.__fixturePlayback.hideAd());

    const libraryPage = await context.newPage();
    await libraryPage.goto(`chrome-extension://${extensionId}/library.html`);
    await libraryPage.waitForSelector(".episode-row");
    const libraryState = await libraryPage.evaluate(() => ({
      episodeLabel: document.querySelector(".episode-identity h4")?.textContent,
      showName: document.querySelector(".detail-title-copy h2")?.textContent
    }));
    assert.equal(libraryState.showName, "庆余年");
    assert.equal(libraryState.episodeLabel, "第 12 集");

    const pinSelector = `[data-pin-show-id="${stored[recordKey].id}"]`;
    await libraryPage.click(pinSelector);
    await libraryPage.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        return button && !button.disabled &&
          button.getAttribute("aria-pressed") === "true";
      },
      pinSelector
    );
    const pinnedRecord = await worker.evaluate(
      (key) =>
        new Promise((resolve) => {
          chrome.storage.sync.get(key, (result) => resolve(result[key]));
        }),
      recordKey
    );
    assert.equal(pinnedRecord.pinned, true);

    await libraryPage.click(pinSelector);
    await libraryPage.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        return button && !button.disabled &&
          button.getAttribute("aria-pressed") === "false";
      },
      pinSelector
    );
    const unpinnedRecord = await worker.evaluate(
      (key) =>
        new Promise((resolve) => {
          chrome.storage.sync.get(key, (result) => resolve(result[key]));
        }),
      recordKey
    );
    assert.equal(unpinnedRecord.pinned, false);

    console.log(
      JSON.stringify(
        {
          extensionId,
          libraryState,
          pinState: {
            pinned: pinnedRecord.pinned,
            unpinned: unpinnedRecord.pinned
          },
          record: stored[recordKey],
          snapshot
        },
        null,
        2
      )
    );
  } finally {
    if (context) {
      await context.close();
    }
    await fixture.close();

    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(`${artifactsRoot}${path.sep}`)) {
      fs.rmSync(resolvedProfile, { force: true, recursive: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
