"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactsRoot = path.resolve(root, "artifacts");
const targetUrl =
  process.env.TARGET_URL ||
  "https://cn.211dm.com/anime/01b4f32464ea949eafbcaed8/play/1/101.html";

function findBrowserExecutable() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Users\\zhoushiqi\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactsRoot, "live-site-profile-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: findBrowserExecutable(),
      headless: true,
      viewport: { height: 900, width: 1440 },
      args: [
        `--disable-extensions-except=${root}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--load-extension=${root}`
      ]
    });

    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(10000);

    const frames = [];
    for (const frame of page.frames()) {
      const details = await frame
        .evaluate(() => ({
          videos: Array.from(document.querySelectorAll("video")).map((video) => ({
            currentTime: video.currentTime,
            duration: video.duration,
            paused: video.paused,
            src: video.currentSrc || video.src
          }))
        }))
        .catch((error) => ({ error: error.message, videos: [] }));
      frames.push({
        url: frame.url(),
        ...details
      });
    }

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    let resumeResult = null;
    if (process.env.TEST_RESUME === "1") {
      const showId = "show_live_resume";
      const now = Date.now();
      const record = {
        duration: 1431,
        episodeCompleted: false,
        episodeLabel: "第 101 集",
        episodeSource: "auto",
        id: showId,
        name: "沧元图",
        pageTitle: "沧元图 101集-Omofun动漫",
        pinned: false,
        pinnedAt: 0,
        position: 600,
        progress: 42,
        seriesKey: "omofun:anime:01b4f32464ea949eafbcaed8",
        site: "omofun",
        siteLabel: "Omofun",
        updatedAt: now,
        url: page.url(),
        version: 3
      };
      await worker.evaluate(
        (payload) =>
          new Promise((resolve) => {
            chrome.storage.sync.set(
              { [`vt.show.${payload.id}`]: payload },
              resolve
            );
          }),
        record
      );
      resumeResult = await extensionPage.evaluate(
        (id) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { id, type: "VT_RESUME_SHOW" },
              resolve
            );
          }),
        showId
      );
      await page.screenshot({
        fullPage: false,
        path: path.join(artifactsRoot, "resume-live-current.png")
      });
    }
    const tabs = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.tabs.query({}, (items) =>
            resolve(items.map((tab) => ({ id: tab.id, url: tab.url })))
          );
        })
    );
    const targetTab = tabs.find((tab) => tab.url && tab.url.startsWith(targetUrl));
    const snapshot = targetTab
      ? await extensionPage.evaluate(
          (tabId) =>
            new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { tabId, type: "VT_GET_SNAPSHOT" },
                resolve
              );
            }),
          targetTab.id
        )
      : null;
    const startResult =
      targetTab && snapshot && snapshot.canTrack
        ? await extensionPage.evaluate(
            ({ episodeLabel, name, tabId }) =>
              new Promise((resolve) => {
                chrome.runtime.sendMessage(
                  {
                    episodeLabel,
                    episodeSource: "auto",
                    name,
                    tabId,
                    type: "VT_START_TRACKING"
                  },
                  resolve
                );
              }),
            {
              episodeLabel: snapshot.episodeLabel,
              name: snapshot.title,
              tabId: targetTab.id
            }
          )
        : null;

    await page.screenshot({
      fullPage: false,
      path: path.join(artifactsRoot, "omofun-live.png")
    });

    console.log(
      JSON.stringify(
        {
          frames,
          resumeResult,
          snapshot,
          startResult,
          title: await page.title(),
          url: page.url()
        },
        null,
        2
      )
    );
  } finally {
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
