"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactsDirectory = path.join(root, "artifacts");

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

function popupMockConfig() {
  const activeRecord = {
    duration: 2700,
    episodeCompleted: false,
    episodeLabel: "第 12 集",
    episodeSource: "auto",
    id: "show_active",
    name: "庆余年",
    pageTitle: "庆余年 第12集 - 腾讯视频",
    position: 1274,
    progress: 47.2,
    seriesKey: "tencent:cover:active",
    site: "tencent",
    siteLabel: "腾讯视频",
    updatedAt: Date.now() - 2 * 60 * 1000,
    url: "https://v.qq.com/x/cover/active/ep12.html",
    version: 1
  };
  const secondRecord = {
    duration: 3300,
    episodeCompleted: false,
    episodeLabel: "第 4 集",
    episodeSource: "auto",
    id: "show_second",
    name: "漫长的季节",
    pageTitle: "漫长的季节 第4集",
    position: 1880,
    progress: 57,
    seriesKey: "bilibili:ss100",
    site: "bilibili",
    siteLabel: "哔哩哔哩",
    updatedAt: Date.now() - 24 * 60 * 60 * 1000,
    url: "https://www.bilibili.com/bangumi/play/ep4",
    version: 1
  };

  return {
    activeRecord,
    records: [activeRecord, secondRecord],
    snapshot: {
      canTrack: true,
      capturedAt: Date.now(),
      currentTime: 1274,
      duration: 2700,
      ended: false,
      episodeLabel: "第 12 集",
      hasVideo: true,
      pageTitle: "庆余年 第12集 - 腾讯视频",
      paused: false,
      playbackRate: 1,
      seriesKey: activeRecord.seriesKey,
      site: "tencent",
      siteLabel: "腾讯视频",
      title: "庆余年",
      url: activeRecord.url
    }
  };
}

async function main() {
  fs.mkdirSync(artifactsDirectory, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true
    });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 392, height: 600 }
    });
    const page = await context.newPage();
    const config = popupMockConfig();

    await page.addInitScript((mockConfig) => {
    let active = true;
    let records = JSON.parse(JSON.stringify(mockConfig.records));
    let snapshot = JSON.parse(JSON.stringify(mockConfig.snapshot));

    window.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage(message, callback) {
          queueMicrotask(() => {
            if (message.type === "VT_GET_APP_STATE") {
              callback({
                ok: true,
                records,
                session: active
                  ? {
                      lastSyncAt: Date.now(),
                      seriesKey: snapshot.seriesKey,
                      showId: mockConfig.activeRecord.id,
                      startedAt: Date.now()
                    }
                  : null,
                syncIssue: null,
                syncState: {
                  cloudEpisodes: 2,
                  cloudShows: 2,
                  lastSyncAt: Date.now() - 10 * 1000,
                  pending: 0,
                  status: "synced"
                }
              });
              return;
            }

            if (message.type === "VT_GET_SNAPSHOT") {
              snapshot = {
                ...snapshot,
                capturedAt: Date.now(),
                paused: false
              };
              callback(snapshot);
              return;
            }

            if (message.type === "VT_STOP_TRACKING") {
              active = false;
              callback({ ok: true, stopped: true });
              return;
            }

            if (message.type === "VT_START_TRACKING") {
              active = true;
              const record = {
                ...mockConfig.activeRecord,
                episodeLabel: message.episodeLabel,
                name: message.name,
                updatedAt: Date.now()
              };
              records = [record, ...records.filter((item) => item.id !== record.id)];
              callback({ ok: true, record });
              return;
            }

            if (message.type === "VT_UPDATE_SHOW") {
              records = records.map((record) =>
                record.id === message.id
                  ? {
                      ...record,
                      episodeLabel: message.episodeLabel,
                      episodeSource: message.episodeSource,
                      name: message.name
                    }
                  : record
              );
              callback({ ok: true });
              return;
            }

            if (message.type === "VT_DELETE_SHOW") {
              records = records.filter((record) => record.id !== message.id);
              callback({ ok: true });
              return;
            }

            callback({ ok: false, error: "Unexpected message" });
          });
        }
      },
      storage: {
        onChanged: {
          addListener() {}
        }
      },
      tabs: {
        create(_options, callback) {
          callback({ id: 90 });
        },
        query(_query, callback) {
          callback([{ id: 42 }]);
        },
        sendMessage(_tabId, _message, callback) {
          callback({ ok: true });
        }
      }
    };
    }, config);

    const popupUrl = pathToFileURL(path.join(root, "popup.html")).href;
    await page.goto(popupUrl, { waitUntil: "load" });
    await page.waitForSelector(".active-summary");
    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "popup-active.png")
    });

    const metrics = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"))
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            height: rect.height,
            label: button.getAttribute("aria-label") || button.textContent.trim(),
            width: rect.width
          };
        });
      return {
        activeTitle: document.querySelector(".video-title")?.textContent,
        bodyHeight: document.body.getBoundingClientRect().height,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        rows: document.querySelectorAll(".show-row").length,
        syncLabel: document.getElementById("syncLabel")?.textContent,
        smallButtons: buttons.filter((button) => button.height < 40)
      };
    });

    assert.equal(metrics.activeTitle, "庆余年");
    assert.equal(metrics.rows, 2);
    assert.equal(metrics.syncLabel, "本地云端已对齐");
    assert.equal(metrics.horizontalOverflow, false);
    assert.deepEqual(metrics.smallButtons, []);

    await page.click('.active-actions [data-action="edit"]');
    await page.waitForSelector("#editDialog[open]");
    await page.fill("#editName", "庆余年 第二季");
    await page.click("#editSave");
    await page.waitForFunction(() => !document.getElementById("editDialog").open);
    await page.waitForFunction(
      () => document.querySelector(".video-title")?.textContent === "庆余年 第二季"
    );
    await page.click('.active-actions [data-action="edit"]');
    await page.waitForSelector("#editDialog[open]");
    const editButtonReset = await page.evaluate(() => {
      const button = document.getElementById("editSave");
      return !button.disabled && button.textContent.includes("保存");
    });
    assert.equal(editButtonReset, true);
    await page.click('[data-close-dialog="editDialog"]');

    await page.click("#stopTracking");
    await page.waitForSelector("#trackForm");
    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "popup-start.png")
    });

    const fixedWidth = await page.evaluate(() => ({
      body: document.body.getBoundingClientRect().width,
      shell: document.querySelector(".app-shell").getBoundingClientRect().width
    }));
    assert.equal(fixedWidth.body, 392);
    assert.equal(fixedWidth.shell, 392);

    console.log(JSON.stringify({ metrics, screenshots: artifactsDirectory }, null, 2));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
