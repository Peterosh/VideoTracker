"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = path.resolve(
  process.env.EXTENSION_ROOT || projectRoot
);
const artifactsRoot = path.resolve(projectRoot, "artifacts");
const targetUrl =
  process.env.TARGET_URL ||
  "https://cn.211dm.com/anime/01b4f32464ea949eafbcaed8/play/1/101.html";
const trials = Math.max(1, Number(process.env.RESUME_TRIALS) || 4);
const savedPosition = Math.max(
  0,
  Number(process.env.RESUME_POSITION) || 600
);
const savedDuration = Math.max(
  0,
  Number(process.env.RESUME_DURATION) || 1431
);
const clickPausedVideo = process.env.CLICK_PAUSED === "1";
const verbose = process.env.VERBOSE === "1";
const playerDelayMs = Math.max(0, Number(process.env.PLAYER_DELAY_MS) || 0);
const mediaDelayMs = Math.max(0, Number(process.env.MEDIA_DELAY_MS) || 0);
const observationDelays = [0, 2000, 4000, 6000, 10000];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

async function readPlayback(page) {
  const frames = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) {
      continue;
    }
    const details = await frame
      .evaluate(() =>
        Array.from(document.querySelectorAll("video")).map((video) => ({
          currentTime: Number(video.currentTime) || 0,
          duration: Number(video.duration) || 0,
          ended: Boolean(video.ended),
          guard: video.__videoTrackerResumeGuard
            ? {
                active: Boolean(video.__videoTrackerResumeGuard.active),
                position:
                  Number(video.__videoTrackerResumeGuard.position) || 0,
                userInteracted: Boolean(
                  video.__videoTrackerResumeGuard.userInteracted
                )
              }
            : null,
          paused: Boolean(video.paused),
          readyState: Number(video.readyState) || 0,
          source: String(video.currentSrc || video.src || "")
        }))
      )
      .catch(() => []);
    if (details.length) {
      frames.push({ url: frame.url(), videos: details });
    }
  }

  const videos = frames.flatMap((frame) =>
    frame.videos.map((video) => ({ ...video, frameUrl: frame.url }))
  );
  videos.sort((left, right) => right.duration - left.duration);
  return {
    pageUrl: page.url(),
    video: videos[0] || null,
    videos
  };
}

async function waitForPlaybackVideo(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const playback = await readPlayback(page);
    if (playback.video && playback.video.duration > 0) {
      return playback;
    }
    await delay(500);
  }
  return readPlayback(page);
}

async function clickPausedPlayback(page, video) {
  if (!video || !video.paused || !video.frameUrl) {
    return false;
  }
  const frame = page.frames().find((item) => item.url() === video.frameUrl);
  if (!frame) {
    return false;
  }
  const locator = frame.locator("video").first();
  if (!(await locator.count().catch(() => 0))) {
    return false;
  }
  await locator.click({ force: true }).catch(() => null);
  return true;
}

async function main() {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const profile = fs.mkdtempSync(
    path.join(artifactsRoot, "live-resume-repeat-profile-")
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: findBrowserExecutable(),
      headless: true,
      viewport: { height: 900, width: 1440 },
      args: [
        `--disable-extensions-except=${extensionRoot}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--load-extension=${extensionRoot}`
      ]
    });
    if (playerDelayMs || mediaDelayMs) {
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        const requestDelay = requestUrl.includes("art.v2player.top")
          ? playerDelayMs
          : requestUrl.includes("tiktokcdn")
            ? mediaDelayMs
            : 0;
        if (requestDelay) {
          await delay(requestDelay);
        }
        await route.continue().catch(() => {});
      });
    }

    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);

    const results = [];
    for (let trial = 1; trial <= trials; trial += 1) {
      const showId = "show_live_resume_repeat";
      const now = Date.now();
      const record = {
        duration: savedDuration,
        episodeCompleted: false,
        episodeLabel: "第 101 集",
        episodeSource: "auto",
        id: showId,
        name: "沧元图",
        pageTitle: "沧元图 101集-Omofun动漫",
        pinned: false,
        pinnedAt: 0,
        position: savedPosition,
        progress: Math.round((savedPosition / savedDuration) * 1000) / 10,
        seriesKey: "omofun:anime:01b4f32464ea949eafbcaed8",
        site: "omofun",
        siteLabel: "Omofun",
        updatedAt: now,
        url: targetUrl,
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

      const pagePromise = context.waitForEvent("page", { timeout: 20000 });
      const resumeResult = await extensionPage.evaluate(
        (id) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { id, type: "VT_RESUME_SHOW" },
              resolve
            );
          }),
        showId
      );
      const resumedPage = await pagePromise.catch(() => null);
      if (!resumedPage || !resumeResult || !resumeResult.ok) {
        results.push({ resumeResult, trial, video: null });
        if (resumedPage) {
          await resumedPage.close().catch(() => {});
        }
        continue;
      }

      const firstPlayback = await waitForPlaybackVideo(resumedPage, 20000);
      const observations = [];
      let lastDelay = 0;
      for (const observationDelay of observationDelays) {
        await delay(Math.max(0, observationDelay - lastDelay));
        lastDelay = observationDelay;
        const playback = await readPlayback(resumedPage);
        const observation = {
          afterResumeMs: observationDelay,
          playback
        };
        if (
          observationDelay === 0 &&
          clickPausedVideo &&
          playback.video &&
          playback.video.paused
        ) {
          observation.clickedPlay = await clickPausedPlayback(
            resumedPage,
            playback.video
          );
        }
        observations.push(observation);
      }

      const requestedPosition = Number(resumeResult.requestedPosition) || 0;
      const finalVideo = observations.at(-1)?.playback.video || null;
      const finalTime = Number(finalVideo && finalVideo.currentTime) || 0;
      const success =
        Boolean(finalVideo) &&
        finalTime >= Math.max(0, requestedPosition - 5);
      if (!success) {
        await resumedPage.screenshot({
          fullPage: false,
          path: path.join(
            artifactsRoot,
            `resume-repeat-failed-${trial}.png`
          )
        });
      }

      results.push({
        firstPlayback,
        observations,
        requestedPosition,
        resumeResult,
        success,
        trial
      });
      await resumedPage.close().catch(() => {});
      await delay(1000);
    }

    const reportedResults = verbose
      ? results
      : results.map((result) => ({
          observations: (result.observations || []).map((observation) => ({
            afterResumeMs: observation.afterResumeMs,
            clickedPlay: Boolean(observation.clickedPlay),
            currentTime:
              Number(observation.playback?.video?.currentTime) || 0,
            duration: Number(observation.playback?.video?.duration) || 0,
            guard: observation.playback?.video?.guard || null,
            paused: Boolean(observation.playback?.video?.paused)
          })),
          requestedPosition: result.requestedPosition,
          resumeResult: result.resumeResult,
          success: result.success,
          trial: result.trial
        }));
    console.log(
      JSON.stringify(
        {
          extensionId,
          extensionRoot,
          results: reportedResults,
          summary: {
            failed: results.filter((result) => !result.success).length,
            passed: results.filter((result) => result.success).length,
            trials
          },
          targetUrl
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
