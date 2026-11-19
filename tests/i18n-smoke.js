"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");

async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      headless: true
    });
    const context = await browser.newContext({
      viewport: { height: 800, width: 1280 }
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const localStore = { "vt.networkInfoEnabled": false };
      window.__networkProbe = { fetchCalls: 0, peerCalls: 0 };
      window.fetch = () => {
        window.__networkProbe.fetchCalls += 1;
        return Promise.reject(new Error("Network disabled in test"));
      };
      window.RTCPeerConnection = class {
        constructor() {
          window.__networkProbe.peerCalls += 1;
        }
      };
      window.chrome = {
        i18n: {
          getUILanguage: () => "en-US"
        },
        runtime: {
          id: "test-extension",
          lastError: undefined,
          sendMessage(message, callback) {
            queueMicrotask(() => {
              if (message.type === "VT_GET_APP_STATE") {
                callback({
                  device: null,
                  devices: [],
                  ok: true,
                  records: [],
                  session: null,
                  syncIssue: null,
                  syncState: {
                    cloudEpisodes: 0,
                    cloudShows: 0,
                    lastSyncAt: Date.now(),
                    pending: 0,
                    status: "synced"
                  }
                });
                return;
              }
              if (message.type === "VT_GET_SNAPSHOT") {
                callback({
                  canTrack: false,
                  error: "Video detection is not supported on this page",
                  hasVideo: false
                });
                return;
              }
              if (message.type === "VT_GET_LIBRARY_STATE") {
                callback({
                  device: null,
                  devices: [],
                  episodes: [],
                  ok: true,
                  shows: [],
                  syncIssue: null,
                  syncState: {
                    cloudEpisodes: 0,
                    cloudShows: 0,
                    lastSyncAt: Date.now(),
                    pending: 0,
                    status: "synced"
                  }
                });
                return;
              }
              callback({ ok: true });
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
            callback({ id: 2 });
          },
          query(_query, callback) {
            callback([{ id: 1 }]);
          },
          sendMessage(_tabId, _message, callback) {
            callback(null);
          }
        }
      };
    });

    await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
    await page.waitForSelector(".empty-current");
    const popup = await page.evaluate(() => ({
      brand: document.querySelector(".brand-copy strong")?.textContent,
      empty: document.querySelector(".empty-current h1")?.textContent,
      lang: document.documentElement.lang,
      syncLabel: document.getElementById("syncButtonLabel")?.textContent,
      tabs: Array.from(
        document.querySelectorAll(".popup-tab"),
        (tab) => tab.textContent.trim()
      )
    }));
    assert.equal(popup.brand, "VideoTracker");
    assert.equal(popup.empty, "No video detected");
    assert.equal(popup.lang, "en-US");
    assert.equal(popup.syncLabel, "Sync now");
    assert.deepEqual(popup.tabs, ["Current video", "Tracked shows"]);

    const disabledNetworkCalls = await page.evaluate(() => window.__networkProbe);
    assert.deepEqual(disabledNetworkCalls, { fetchCalls: 0, peerCalls: 0 });

    await page.click("#libraryTab");
    await page.waitForSelector("#libraryPanel:not([hidden])");
    const popupLibrary = await page.evaluate(() => ({
      placeholder: document.getElementById("librarySearch")?.placeholder,
      searchLabel: document.getElementById("librarySearch")?.getAttribute(
        "aria-label"
      )
    }));
    assert.equal(popupLibrary.placeholder, "Search shows or episodes");
    assert.equal(popupLibrary.searchLabel, "Search tracked shows");

    await page.goto(pathToFileURL(path.join(root, "library.html")).href);
    await page.waitForSelector(".sync-card");
    const library = await page.evaluate(() => ({
      brand: document.querySelector(".brand-group h1")?.textContent,
      heading: document.getElementById("showsTitle")?.textContent,
      languageOptions: Array.from(
        document.querySelectorAll("[data-language]"),
        (option) => option.dataset.language
      ),
      languageValue: document.getElementById("languageCurrent")?.textContent,
      languageExpanded: document
        .getElementById("languageButton")
        ?.getAttribute("aria-expanded"),
      headerNetworkControl: Boolean(
        document.querySelector(".app-header #networkInfoToggle")
      ),
      lang: document.documentElement.lang,
      networkLabel: document.querySelector(".network-toggle-label")?.textContent,
      syncState: document.getElementById("syncStateText")?.textContent,
      topSyncPill: Boolean(document.querySelector(".app-header .sync-pill"))
    }));
    assert.equal(library.brand, "VideoTracker");
    assert.equal(library.heading, "Tracked shows");
    assert.deepEqual(library.languageOptions, ["zh", "en"]);
    assert.equal(library.languageValue, "English");
    assert.equal(library.languageExpanded, "false");
    assert.equal(library.headerNetworkControl, true);
    assert.equal(library.networkLabel, "Network information");
    assert.equal(library.syncState, "Local and cloud are aligned");
    assert.equal(library.lang, "en-US");
    assert.equal(library.topSyncPill, false);

    await page.click("#devicesTab");
    await page.waitForSelector(".device-view:not([hidden])");
    const devices = await page.evaluate(() => ({
      heading: document.querySelector(".device-view-heading h2")?.textContent,
      networkState: document.getElementById("deviceNetworkState")?.textContent,
      tabSelected:
        document.getElementById("devicesTab")?.getAttribute("aria-current")
    }));
    assert.equal(devices.heading, "Device management");
    assert.equal(devices.networkState, "Network information disabled");
    assert.equal(devices.tabSelected, "page");

    await page.setViewportSize({ height: 844, width: 390 });
    const englishMobile = await page.evaluate(() => ({
      headerOverflow:
        document.querySelector(".app-header").scrollWidth >
        document.querySelector(".app-header").clientWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth
    }));
    assert.equal(englishMobile.headerOverflow, false);
    assert.equal(englishMobile.horizontalOverflow, false);

    await page.click("#languageButton");
    await page.waitForSelector("#languageOptions:not([hidden])");
    const languageMenu = await page.evaluate(() => {
      const menu = document
        .getElementById("languageOptions")
        .getBoundingClientRect();
      return {
        expanded: document
          .getElementById("languageButton")
          ?.getAttribute("aria-expanded"),
        options: Array.from(
          document.querySelectorAll("[data-language]"),
          (option) => ({
            label: option.textContent.trim(),
            selected: option.getAttribute("aria-selected"),
            value: option.dataset.language
          })
        ),
        viewportOverflow:
          menu.left < 0 ||
          menu.right > window.innerWidth ||
          menu.top < 0 ||
          menu.bottom > window.innerHeight
      };
    });
    assert.equal(languageMenu.expanded, "true");
    assert.equal(languageMenu.viewportOverflow, false);
    assert.deepEqual(
      languageMenu.options.map((option) => option.label),
      ["中文", "English"]
    );
    assert.equal(
      languageMenu.options.find((option) => option.value === "en")?.selected,
      "true"
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("languageOptions")?.hidden
    );
    await page.focus("#languageButton");
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector("#languageOptions:not([hidden])");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset.language),
      "en"
    );

    const navigation = page.waitForNavigation({ waitUntil: "load" });
    await page.click('[data-language="zh"]');
    await navigation;
    await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    const switchedLanguage = await page.evaluate(() => ({
      brand: document.querySelector(".brand-group h1")?.textContent,
      heading: document.getElementById("showsTitle")?.textContent,
      language: navigator.language,
      stored: localStorage.getItem("vt.uiLanguage")
    }));
    assert.equal(switchedLanguage.brand, "剧迹");
    assert.equal(switchedLanguage.heading, "追踪剧集");
    assert.equal(switchedLanguage.stored, "zh");
    await page.evaluate(() => localStorage.removeItem("vt.uiLanguage"));

    for (const locale of ["zh_CN", "en"]) {
      const messages = JSON.parse(
        fs.readFileSync(
          path.join(root, "_locales", locale, "messages.json"),
          "utf8"
        )
      );
      assert.ok(messages.extensionName?.message);
      assert.ok(messages.extensionDescription?.message);
    }

    console.log(
      JSON.stringify(
        {
          devices,
          englishMobile,
          library,
          popup,
          popupLibrary,
          switchedLanguage
        },
        null,
        2
      )
    );
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
