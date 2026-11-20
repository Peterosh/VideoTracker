"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactsRoot = path.resolve(root, "artifacts");

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function findPopupTarget(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (response && response.ok) {
      const targets = await response.json();
      const popup = targets.find((target) => target.url.endsWith("/popup.html"));
      if (popup) {
        return popup;
      }
    }
    await delay(150);
  }
  throw new Error("Extension action popup target did not open");
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;

    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) {
        return;
      }
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result);
      }
    });
    socket.addEventListener("open", () => {
      resolve({
        close() {
          socket.close();
        },
        send(method, params) {
          return new Promise((resolveCommand, rejectCommand) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, {
              reject: rejectCommand,
              resolve: resolveCommand
            });
            socket.send(JSON.stringify({ id, method, params: params || {} }));
          });
        }
      });
    }, { once: true });
  });
}

async function waitForPopupReady(cdp) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression:
        "Boolean(document.querySelector('.empty-current, .waiting-state, .track-form, .active-summary'))",
      returnByValue: true
    });
    if (evaluation.result.value) {
      return;
    }
    await delay(150);
  }
  throw new Error("Popup content did not finish rendering");
}

async function main() {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactsRoot, "popup-action-profile-"));
  const debuggingPort = await getFreePort();
  let context;
  let cdp;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: findBrowserExecutable(),
      headless: true,
      args: [
        `--disable-extensions-except=${root}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--load-extension=${root}`,
        `--remote-debugging-port=${debuggingPort}`
      ]
    });

    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    const now = Date.now();
    await worker.evaluate(
      ({ checkedAt, updatedAt }) =>
        new Promise((resolve, reject) => {
          chrome.storage.sync.set(
            {
              "vt.latest.show_popup_fixture": {
                checkedAt,
                detectedAt: checkedAt,
                episodeLabel: "第 103 集",
                episodeNumber: 103,
                error: "",
                id: "show_popup_fixture",
                showId: "show_popup_fixture",
                source: "latest-range",
                status: "ok",
                updatedAt: checkedAt
              },
              "vt.show.show_popup_fixture": {
                duration: 2400,
                episodeCompleted: false,
                episodeLabel: "第 101 集",
                episodeSource: "auto",
                id: "show_popup_fixture",
                maxWatchedEpisodeLabel: "第 101 集",
                maxWatchedEpisodeNumber: 101,
                name: "沧元图",
                pageTitle: "沧元图 第101集",
                pinned: false,
                pinnedAt: 0,
                position: 720,
                progress: 30,
                seriesKey: "fixture:popup",
                site: "generic",
                siteLabel: "网页视频",
                updatedAt,
                url: "https://example.com/watch/101",
                version: 3
              }
            },
            () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve();
            }
          );
        }),
      {
        checkedAt: now - 60 * 1000,
        updatedAt: now - 5 * 60 * 1000
      }
    );
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("data:text/html,<title>Popup layout check</title>");
    await worker.evaluate(() => chrome.action.openPopup());

    const target = await findPopupTarget(debuggingPort);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitForPopupReady(cdp);
    await delay(100);

    const evaluation = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `JSON.stringify((() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const sync = document.querySelector(".sync-button").getBoundingClientRect();
        const current = document.querySelector(".current-section").getBoundingClientRect();
        return {
          bodyWidth: document.body.getBoundingClientRect().width,
          brandRight: brand.right,
          currentWidth: current.width,
          documentScrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          syncLeft: sync.left,
          syncLabel: document.getElementById("syncButtonLabel")?.textContent
        };
      })())`,
      returnByValue: true
    });
    const metrics = JSON.parse(evaluation.result.value);

    assert.ok(metrics.innerWidth >= 380, `popup viewport is too narrow: ${metrics.innerWidth}`);
    assert.ok(metrics.bodyWidth >= 380, `popup body is too narrow: ${metrics.bodyWidth}`);
    assert.ok(metrics.currentWidth >= 340, `current section is too narrow: ${metrics.currentWidth}`);
    assert.ok(
      metrics.brandRight <= metrics.syncLeft,
      "brand and sync status must not overlap"
    );
    assert.equal(metrics.syncLabel, "立即同步");
    assert.ok(
      metrics.documentScrollWidth <= metrics.innerWidth + 1,
      "popup should not have horizontal overflow"
    );

    const tabEvaluation = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(async () => {
        document.getElementById("libraryTab").click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const firstRow = document.querySelector(".show-row");
        return JSON.stringify({
          libraryHidden: document.getElementById("libraryPanel").hidden,
          latestEpisode: firstRow?.querySelector(
            ".show-meta-secondary"
          )?.textContent.replace(/\\s+/g, " ").trim(),
          newEpisodeTag: firstRow?.querySelector(".new-episode-tag")
            ?.textContent,
          rowCount: document.querySelectorAll(".show-row").length,
          searchHeight: document.querySelector(".library-search")
            .getBoundingClientRect().height,
          selected: document.getElementById("libraryTab")
            .getAttribute("aria-selected")
        });
      })()`,
      returnByValue: true
    });
    const tabMetrics = JSON.parse(tabEvaluation.result.value);
    assert.equal(tabMetrics.libraryHidden, false);
    assert.equal(tabMetrics.selected, "true");
    assert.equal(tabMetrics.rowCount, 1);
    assert.match(tabMetrics.latestEpisode, /最高 第 101 集/);
    assert.match(tabMetrics.latestEpisode, /最新 第 103 集/);
    assert.equal(tabMetrics.newEpisodeTag, "新集");
    assert.ok(tabMetrics.searchHeight >= 40);

    await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "VT_GET_LIBRARY_STATE" },
          () => resolve()
        );
      })`
    });
    const badgeText = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.action.getBadgeText({}, resolve);
        })
    );
    assert.equal(badgeText, "NEW");

    const screenshot = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png"
    });
    fs.writeFileSync(
      path.join(artifactsRoot, "popup-action.png"),
      Buffer.from(screenshot.data, "base64")
    );

    console.log(
      JSON.stringify(
        {
          badgeText,
          metrics,
          screenshot: "artifacts/popup-action.png",
          tabMetrics
        },
        null,
        2
      )
    );
  } finally {
    if (cdp) {
      cdp.close();
    }
    if (context) {
      await context.close();
    }

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
