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
      hasNewEpisode: true,
      id: "show_omofun",
      latestCheckedAt: now - 2 * 60 * 1000,
      latestCheckError: "",
      latestEpisodeLabel: "第 103 集",
      latestEpisodeNumber: 103,
      latestEpisodeStatus: "ok",
      maxWatchedEpisodeLabel: "第 101 集",
      maxWatchedEpisodeNumber: 101,
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
      hasNewEpisode: false,
      id: "show_tencent",
      latestCheckedAt: now - 60 * 60 * 1000,
      latestCheckError: "",
      latestEpisodeLabel: "第 12 集",
      latestEpisodeNumber: 12,
      latestEpisodeStatus: "ok",
      maxWatchedEpisodeLabel: "第 12 集",
      maxWatchedEpisodeNumber: 12,
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
      window.__openedUrls = [];
      window.__resumeMessages = [];
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
              if (message.type === "VT_RESUME_SHOW") {
                window.__resumeMessages.push(message);
                const requestedEpisode = message.episodeId
                  ? currentState.episodes.find(
                      (episode) => episode.id === message.episodeId
                    )
                  : null;
                callback({
                  allComplete: false,
                  currentTime: 777,
                  episodeLabel:
                    requestedEpisode?.episodeLabel || "第 101 集",
                  ok: true,
                  requestedPosition: 777,
                  resumed: true,
                  tabId: 1,
                  url:
                    requestedEpisode?.url ||
                    currentState.shows.find(
                      (show) => show.id === message.id
                    )?.url
                });
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
              if (message.type === "VT_SET_SHOW_PINNED") {
                setTimeout(() => {
                  let updatedRecord = null;
                  currentState.shows = currentState.shows
                    .map((show) => {
                      if (show.id !== message.id) {
                        return show;
                      }
                      updatedRecord = {
                        ...show,
                        pinned: message.pinned,
                        pinnedAt: message.pinned ? Date.now() : 0
                      };
                      return updatedRecord;
                    })
                    .sort((left, right) => {
                      if (Boolean(left.pinned) !== Boolean(right.pinned)) {
                        return left.pinned ? -1 : 1;
                      }
                      return Number(right.updatedAt) - Number(left.updatedAt);
                    });
                  callback({
                    deferredSync: false,
                    ok: true,
                    record: updatedRecord
                  });
                }, 300);
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
            addListener(listener) {
              window.__emitStorageChange = listener;
            }
          }
        },
        tabs: {
          create(options, callback) {
            window.__openedUrls.push(options.url);
            callback({ id: window.__openedUrls.length + 10 });
          },
          query(_queryInfo, callback) {
            callback([]);
          },
          update(tabId, _properties, callback) {
            callback({ id: tabId });
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
      highestEpisode: document.querySelector(
        '[data-stat="max-watched"] .stat-value'
      )?.textContent,
      latestEpisode: document.querySelector(
        '[data-stat="latest-episode"] .stat-value'
      )?.textContent,
      latestCheck: document.querySelector(
        ".latest-check > span:not(.icon)"
      )?.textContent,
      newEpisodeTags: document.querySelectorAll(".new-episode-tag").length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      showItems: document.querySelectorAll(".show-item").length,
      showEpisodeSummary: document.querySelector(
        ".show-item.is-active .show-meta-secondary"
      )?.textContent.replace(/\s+/g, " ").trim(),
      title: document.querySelector(".detail-title-copy h2")?.textContent
    }));
    assert.equal(desktopMetrics.showItems, 2);
    assert.equal(desktopMetrics.episodeRows, 2);
    assert.equal(desktopMetrics.title, "沧元图");
    assert.equal(desktopMetrics.syncStateLabel, "本地与云端已对齐");
    assert.equal(desktopMetrics.deviceCell, "书房电脑");
    assert.equal(desktopMetrics.publicIpCell, "公网 36.110.12.34");
    assert.equal(desktopMetrics.highestEpisode, "第 101 集");
    assert.equal(desktopMetrics.latestEpisode, "第 103 集");
    assert.match(desktopMetrics.latestCheck, /最近检查/);
    assert.equal(desktopMetrics.newEpisodeTags, 1);
    assert.match(desktopMetrics.showEpisodeSummary, /最高 第 101 集/);
    assert.match(desktopMetrics.showEpisodeSummary, /最新 第 103 集/);
    assert.equal(desktopMetrics.horizontalOverflow, false);

    await page.click("[data-resume-show-id]");
    await page.waitForFunction(() =>
      document.getElementById("toast")?.textContent.includes("继续播放")
    );
    const resumeState = await page.evaluate(() => ({
      buttonDisabled: document.querySelector("[data-resume-show-id]")?.disabled,
      messages: window.__resumeMessages,
      toast: document.getElementById("toast")?.textContent
    }));
    assert.deepEqual(resumeState.messages, [
      { id: "show_omofun", type: "VT_RESUME_SHOW" }
    ]);
    assert.equal(resumeState.buttonDisabled, false);
    assert.match(resumeState.toast, /已从 12:57 继续播放第 101 集/);

    await page.click("[data-open-url]");
    await page.waitForFunction(() => window.__resumeMessages.length === 2);
    const episodeOpenState = await page.evaluate(() => ({
      messages: window.__resumeMessages,
      openedUrls: window.__openedUrls
    }));
    assert.deepEqual(episodeOpenState.messages[1], {
      episodeId: "show_omofun.ep101",
      id: "show_omofun",
      type: "VT_RESUME_SHOW"
    });
    assert.deepEqual(episodeOpenState.openedUrls, []);

    await page.click("#languageButton");
    await page.waitForSelector("#languageOptions:not([hidden])");
    const languageMenu = await page.evaluate(() => {
      const menu = document.getElementById("languageOptions").getBoundingClientRect();
      return {
        selected: document
          .querySelector('[data-language="zh"]')
          ?.getAttribute("aria-selected"),
        viewportOverflow:
          menu.left < 0 ||
          menu.right > window.innerWidth ||
          menu.top < 0 ||
          menu.bottom > window.innerHeight
      };
    });
    assert.equal(languageMenu.selected, "true");
    assert.equal(languageMenu.viewportOverflow, false);
    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsDirectory, "language-menu.png")
    });
    await page.click("#languageButton");

    await page.click("#devicesTab");
    await page.waitForSelector(".device-view:not([hidden])");
    const deviceRows = await page.locator(".device-row").count();
    assert.equal(deviceRows, 2);
    const firstDeviceName = page.locator("[data-device-name]").first();
    await firstDeviceName.focus();
    await firstDeviceName.fill("书房主机");
    await page.evaluate(() => {
      window.__emitStorageChange(
        { "vt.episode.refresh": { newValue: { updatedAt: Date.now() } } },
        "sync"
      );
    });
    await page.waitForTimeout(350);
    const editingState = await page.evaluate(() => ({
      focused: document.activeElement?.matches("[data-device-name]"),
      value: document.activeElement?.value
    }));
    assert.equal(editingState.focused, true);
    assert.equal(editingState.value, "书房主机");
    await firstDeviceName.press("Enter");
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

    const pinTencent = page.locator('[data-pin-show-id="show_tencent"]');
    const pinTencentBox = await pinTencent.boundingBox();
    await page.mouse.move(
      pinTencentBox.x + pinTencentBox.width / 2,
      pinTencentBox.y + pinTencentBox.height / 2
    );
    await page.mouse.down();
    await page.evaluate(() => {
      window.__emitStorageChange(
        {
          "vt.show.show_tencent": {
            newValue: { id: "show_tencent", pinned: false }
          }
        },
        "sync"
      );
    });
    await page.waitForTimeout(220);
    await page.mouse.up();
    const optimisticPin = await page.evaluate(() => ({
      firstShowId: document
        .querySelector(".show-item [data-show-id]")
        ?.getAttribute("data-show-id"),
      pending: document
        .querySelector(".show-item [data-pin-show-id]")
        ?.getAttribute("aria-busy")
    }));
    assert.equal(optimisticPin.firstShowId, "show_tencent");
    assert.equal(optimisticPin.pending, "true");
    await page.waitForFunction(
      () =>
        document.querySelector(".show-item [data-show-id]")
          ?.getAttribute("data-show-id") === "show_tencent"
    );
    const pinnedShow = await page.evaluate(() => ({
      firstShowId: document
        .querySelector(".show-item [data-show-id]")
        ?.getAttribute("data-show-id"),
      pressed: document
        .querySelector('[data-pin-show-id="show_tencent"]')
        ?.getAttribute("aria-pressed")
    }));
    assert.equal(pinnedShow.firstShowId, "show_tencent");
    assert.equal(pinnedShow.pressed, "true");
    await page.waitForFunction(
      () => !document.querySelector('[data-pin-show-id="show_tencent"]')
        ?.disabled
    );
    await page.click('[data-pin-show-id="show_tencent"]');
    await page.waitForFunction(
      () => {
        const button = document.querySelector(
          '[data-pin-show-id="show_tencent"]'
        );
        return button && !button.disabled &&
          button.getAttribute("aria-pressed") === "false";
      }
    );

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
