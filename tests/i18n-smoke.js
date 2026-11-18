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
      lang: document.documentElement.lang
    }));
    assert.equal(popup.brand, "VideoTracker");
    assert.equal(popup.empty, "No video detected");
    assert.equal(popup.lang, "en-US");

    const disabledNetworkCalls = await page.evaluate(() => window.__networkProbe);
    assert.deepEqual(disabledNetworkCalls, { fetchCalls: 0, peerCalls: 0 });

    await page.goto(pathToFileURL(path.join(root, "library.html")).href);
    await page.waitForSelector(".sync-card");
    const library = await page.evaluate(() => ({
      heading: document.getElementById("showsTitle")?.textContent,
      lang: document.documentElement.lang,
      networkLabel: document.querySelector(
        "label[for='networkInfoToggle'] strong"
      )?.textContent,
      syncState: document.getElementById("syncStateText")?.textContent
    }));
    assert.equal(library.heading, "Tracked shows");
    assert.equal(library.networkLabel, "Network information");
    assert.equal(library.syncState, "Local and cloud are aligned");
    assert.equal(library.lang, "en-US");

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

    console.log(JSON.stringify({ library, popup }, null, 2));
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
