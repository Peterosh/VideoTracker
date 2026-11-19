"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactsDirectory = path.join(root, "artifacts");

function fixture() {
  const now = Date.now();
  const shows = [
    {
      duration: 1431,
      episodeCompleted: false,
      episodeLabel: "第 101 集",
      deviceBrowser: "Microsoft Edge",
      deviceId: "device-current",
      deviceIp: "10.95.8.33",
      deviceName: "书房电脑",
      devicePlatform: "Windows",
      devicePublicIp: "36.110.12.34",
      id: "show_omofun",
      name: "沧元图",
      pageTitle: "沧元图 101集-Omofun动漫",
      position: 780,
      progress: 54.5,
      seriesKey: "omofun:anime:01b4",
      site: "omofun",
      siteLabel: "Omofun",
      updatedAt: now - 4 * 60 * 1000,
      url: "https://cn.211dm.com/anime/01b4/play/1/101.html",
      version: 2
    },
    {
      duration: 2700,
      episodeCompleted: false,
      episodeLabel: "第 12 集",
      id: "show_tencent",
      name: "庆余年",
      pageTitle: "庆余年 第12集 - 腾讯视频",
      position: 1274,
      progress: 47.2,
      seriesKey: "tencent:cover:active",
      site: "tencent",
      siteLabel: "腾讯视频",
      updatedAt: now - 26 * 60 * 60 * 1000,
      url: "https://v.qq.com/x/cover/active/ep12.html",
      version: 2
    }
  ];
  const episodes = [
    {
      completed: false,
      deviceBrowser: "Microsoft Edge",
      deviceId: "device-current",
      deviceIp: "10.95.8.33",
      deviceName: "书房电脑",
      devicePlatform: "Windows",
      devicePublicIp: "36.110.12.34",
      duration: 1431,
      episodeLabel: "第 101 集",
      firstSeenAt: now - 20 * 60 * 1000,
      id: "show_omofun.ep101",
      pageTitle: "沧元图 101集-Omofun动漫",
      position: 780,
      progress: 54.5,
      showId: "show_omofun",
      storageKey: "vt.episode.show_omofun.ep101",
      updatedAt: now - 4 * 60 * 1000,
      url: "https://cn.211dm.com/anime/01b4/play/1/101.html",
      version: 2
    },
    {
      completed: true,
      duration: 1430,
      episodeLabel: "第 100 集",
      deviceBrowser: "Google Chrome",
      deviceId: "device-office",
      deviceIp: "192.168.1.20",
      deviceName: "办公室电脑",
      devicePlatform: "Windows",
      devicePublicIp: "58.246.10.20",
      firstSeenAt: now - 2 * 24 * 60 * 60 * 1000,
      id: "show_omofun.ep100",
      pageTitle: "沧元图 100集-Omofun动漫",
      position: 1420,
      progress: 99.3,
      showId: "show_omofun",
      storageKey: "vt.episode.show_omofun.ep100",
      updatedAt: now - 24 * 60 * 60 * 1000,
      url: "https://cn.211dm.com/anime/01b4/play/1/100.html",
      version: 2
    },
    {
      completed: false,
      duration: 2700,
      episodeLabel: "第 12 集",
      deviceBrowser: "Microsoft Edge",
      deviceId: "device-current",
      deviceIp: "10.95.8.33",
      deviceName: "书房电脑",
      devicePlatform: "Windows",
      devicePublicIp: "36.110.12.34",
      firstSeenAt: now - 3 * 24 * 60 * 60 * 1000,
      id: "show_tencent.ep12",
      pageTitle: "庆余年 第12集 - 腾讯视频",
      position: 1274,
      progress: 47.2,
      showId: "show_tencent",
      storageKey: "vt.episode.show_tencent.ep12",
      updatedAt: now - 26 * 60 * 60 * 1000,
      url: "https://v.qq.com/x/cover/active/ep12.html",
      version: 2
    }
  ];
  return {
    device: {
      browser: "Microsoft Edge",
      customName: true,
      id: "device-current",
      localIp: "10.95.8.33",
      name: "书房电脑",
      networkUpdatedAt: now,
      platform: "Windows",
      publicIp: "36.110.12.34",
      publicIpProvider: "ipify",
      publicIpUpdatedAt: now,
      updatedAt: now
    },
    devices: [
      {
        browser: "Microsoft Edge",
        current: true,
        id: "device-current",
        lastSeenAt: now - 10 * 1000,
        localIp: "10.95.8.33",
        name: "书房电脑",
        platform: "Windows",
        publicIp: "36.110.12.34"
      },
      {
        browser: "Google Chrome",
        current: false,
        id: "device-office",
        lastSeenAt: now - 60 * 1000,
        localIp: "192.168.1.20",
        name: "办公室电脑",
        platform: "Windows",
        publicIp: "58.246.10.20"
      }
    ],
    episodes,
    shows,
    syncIssue: null,
    syncState: {
      cloudEpisodes: 2,
      cloudShows: 2,
      lastSyncAt: now - 10 * 1000,
      pending: 0,
      status: "synced"
    }
  };
}

async function main() {
  fs.mkdirSync(artifactsDirectory, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      headless: true
    });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { height: 800, width: 1280 }
    });
    const page = await context.newPage();
    await page.addInitScript((libraryState) => {
      let currentState = JSON.parse(JSON.stringify(libraryState));
      const localStore = {
        "vt.deviceProfile.v1": libraryState.device
      };
      window.chrome = {
        runtime: {
          lastError: undefined,
          sendMessage(message, callback) {
            queueMicrotask(() => {
              if (message.type === "VT_GET_LIBRARY_STATE") {
                callback({ ok: true, ...currentState });
                return;
              }
              if (message.type === "VT_DELETE_EPISODE") {
                const deletedEpisode = currentState.episodes.find(
                  (episode) => episode.id === message.episodeId
                );
                currentState.episodes = currentState.episodes.filter(
                  (episode) => episode.id !== message.episodeId
                );
                const remaining = currentState.episodes.some(
                  (episode) => episode.showId === deletedEpisode?.showId
                );
                if (!remaining && deletedEpisode) {
                  currentState.shows = currentState.shows.filter(
                    (show) => show.id !== deletedEpisode.showId
                  );
                }
                callback({ ok: true, showDeleted: !remaining });
                return;
              }
              if (message.type === "VT_DELETE_SHOW") {
                currentState.shows = currentState.shows.filter(
                  (show) => show.id !== message.id
                );
                currentState.episodes = currentState.episodes.filter(
                  (episode) => episode.showId !== message.id
                );
                callback({ ok: true });
                return;
              }
              if (message.type === "VT_RENAME_DEVICE") {
                currentState.devices = currentState.devices.map((device) =>
                  device.id === message.deviceId
                    ? { ...device, name: message.name }
                    : device
                );
                if (message.deviceId === currentState.device.id) {
                  currentState.device = {
                    ...currentState.device,
                    name: message.name
                  };
                  localStore["vt.deviceProfile.v1"] = currentState.device;
                }
                callback({
                  device: currentState.device,
                  devices: currentState.devices,
                  ok: true
                });
                return;
              }
              callback({ ok: false, error: "Unexpected message" });
            });
          }
        },
        storage: {
          local: {
            get(keys, callback) {
              queueMicrotask(() => {
                if (typeof keys === "string") {
                  callback(
                    keys in localStore ? { [keys]: localStore[keys] } : {}
                  );
                  return;
                }
                callback({ ...localStore });
              });
            },
            set(values, callback) {
              Object.assign(localStore, values);
              queueMicrotask(callback);
            }
          },
          onChanged: {
            addListener() {}
          }
        },
        tabs: {
          create(_options, callback) {
            callback({ id: 1 });
          }
        }
      };
    }, fixture());

    await page.goto(pathToFileURL(path.join(root, "library.html")).href);
    await page.waitForSelector(".episode-row");

    const desktopMetrics = await page.evaluate(() => ({
      episodeRows: document.querySelectorAll(".episode-row").length,
      syncStateLabel: document.getElementById("syncStateText")?.textContent,
      deviceCell: document.querySelector(".episode-device strong")?.textContent,
      publicIpCell: document.querySelector(
        ".episode-device span:last-child"
      )?.textContent,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      showItems: document.querySelectorAll(".show-item").length,
      title: document.querySelector(".detail-title-copy h2")?.textContent
    }));
    assert.equal(desktopMetrics.showItems, 2);
    assert.equal(desktopMetrics.episodeRows, 2);
    assert.equal(desktopMetrics.title, "沧元图");
    assert.equal(desktopMetrics.syncStateLabel, "本地与云端已对齐");
    assert.equal(desktopMetrics.deviceCell, "书房电脑");
    assert.equal(desktopMetrics.publicIpCell, "公网 36.110.12.34");
    assert.equal(desktopMetrics.horizontalOverflow, false);

    await page.click("#devicesTab");
    await page.waitForSelector(".device-view:not([hidden])");
    const deviceRows = await page.locator(".device-row").count();
    assert.equal(deviceRows, 2);
    await page.locator("[data-device-name]").first().fill("书房主机");
    await page.locator("[data-device-name]").first().blur();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-device-name]")?.value === "书房主机"
    );
    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "library-devices.png")
    });
    await page.click("#libraryTab");

    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "library-desktop.png")
    });

    await page.click('[data-filter="complete"]');
    const completeRows = await page.locator(".episode-row").count();
    assert.equal(completeRows, 1);

    await page.click('[data-show-id="show_tencent"]');
    await page.waitForFunction(
      () => document.querySelector(".detail-title-copy h2")?.textContent === "庆余年"
    );
    await page.click('[data-filter="all"]');

    await page.setViewportSize({ height: 844, width: 390 });
    const mobileMetrics = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      workspaceColumns: getComputedStyle(
        document.querySelector(".workspace")
      ).gridTemplateColumns
    }));
    assert.equal(mobileMetrics.horizontalOverflow, false);
    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "library-mobile.png")
    });

    await page.click(".episode-actions [data-delete-episode]");
    await page.waitForSelector("#deleteDialog[open]");
    await page.click("#confirmDeleteButton");
    await page.waitForFunction(() => !document.getElementById("deleteDialog").open);
    await page.waitForFunction(
      () => document.querySelectorAll(".show-item").length === 1
    );

    console.log(JSON.stringify({ desktopMetrics, mobileMetrics }, null, 2));
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
