"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../core.js");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createStorageArea(store, options, runtime) {
  const settings = options || {};
  return {
    get(keys, callback) {
      queueMicrotask(() => {
        if (settings.failGet) {
          runtime.lastError = { message: settings.failGet };
          callback({});
          runtime.lastError = undefined;
          return;
        }

        let result;
        if (keys == null) {
          result = clone(store);
        } else if (typeof keys === "string") {
          result = keys in store ? { [keys]: clone(store[keys]) } : {};
        } else if (Array.isArray(keys)) {
          result = {};
          for (const key of keys) {
            if (key in store) {
              result[key] = clone(store[key]);
            }
          }
        } else {
          result = {};
          for (const [key, fallback] of Object.entries(keys)) {
            result[key] = key in store ? clone(store[key]) : fallback;
          }
        }
        callback(result);
      });
    },
    set(values, callback) {
      queueMicrotask(() => {
        if (settings.failSet) {
          runtime.lastError = { message: settings.failSet };
          callback();
          runtime.lastError = undefined;
          return;
        }
        Object.assign(store, clone(values));
        callback();
      });
    },
    remove(keys, callback) {
      queueMicrotask(() => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          delete store[key];
        }
        callback();
      });
    }
  };
}

function createHarness(options) {
  const settings = options || {};
  const syncStore = {};
  const localStore = {};
  Object.assign(syncStore, clone(settings.syncStore || {}));
  Object.assign(localStore, clone(settings.localStore || {}));
  const runtime = {
    lastError: undefined,
    onInstalled: null,
    onMessage: null,
    onStartup: null
  };
  const syncArea = createStorageArea(syncStore, {
    failSet: settings.syncSetError
  }, runtime);
  const localArea = createStorageArea(localStore, {}, runtime);
  const listeners = {};
  let currentNow = new Date("2026-11-18T12:00:00+08:00").getTime();
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [currentNow]));
    }

    static now() {
      return currentNow;
    }
  }
  let tab = {
    active: true,
    audible: true,
    id: 7,
    title: "庆余年 第3集 - 腾讯视频",
    url: "https://v.qq.com/x/cover/abc123/ep3.html"
  };
  let frameResult = {
    activeEpisodeText: "",
    adDetected: false,
    adReason: "",
    currentTime: 300,
    duration: 2700,
    ended: false,
    frameTitle: "庆余年 第3集 - 腾讯视频",
    hasVideo: true,
    heading: "庆余年",
    mediaSessionTitle: "",
    ogTitle: "庆余年 第3集 - 腾讯视频",
    paused: false,
    readyState: 4,
    score: 900000,
    url: tab.url,
    videoHeight: 720,
    videoSource: "https://video.example.com/content/episode.mp4",
    videoWidth: 1280
  };

  function addListener(name) {
    return {
      addListener(listener) {
        listeners[name] = listener;
      }
    };
  }

  const chrome = {
    action: {
      setBadgeBackgroundColor() {},
      setBadgeText() {}
    },
    alarms: {
      create() {},
      onAlarm: addListener("alarm")
    },
    runtime,
    scripting: {
      executeScript(details, callback) {
        queueMicrotask(() => {
          if (settings.scriptError) {
            runtime.lastError = { message: settings.scriptError };
            callback([]);
            runtime.lastError = undefined;
            return;
          }
          callback([
            {
              frameId: 3,
              result: clone(frameResult)
            }
          ]);
        });
      }
    },
    storage: {
      local: localArea,
      sync: syncArea
    },
    tabs: {
      get(tabId, callback) {
        queueMicrotask(() => callback(clone(tab)));
      },
      onActivated: addListener("tabActivated"),
      onRemoved: addListener("tabRemoved"),
      onUpdated: addListener("tabUpdated"),
      query(_queryInfo, callback) {
        queueMicrotask(() => callback([clone(tab)]));
      }
    },
    windows: {
      onFocusChanged: addListener("windowFocusChanged")
    }
  };
  runtime.onInstalled = addListener("installed");
  runtime.onMessage = addListener("message");
  runtime.onStartup = addListener("startup");

  const context = {
    Date: FakeDate,
    Error,
    Map,
    Math,
    Object,
    Promise,
    String,
    URL,
    chrome,
    console,
    queueMicrotask,
    self: {},
    setTimeout
  };
  context.globalThis = context;
  context.self.VideoTrackerCore = Core;
  context.self.VideoTrackerI18n = {
    t: (value) => value
  };
  context.importScripts = () => {};
  vm.createContext(context);

  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });

  function send(message, sender) {
    return new Promise((resolve) => {
      listeners.message(message, sender || {}, resolve);
    });
  }

  return {
    advanceTime(milliseconds) {
      currentNow += milliseconds;
    },
    get localStore() {
      return localStore;
    },
    send,
    setFrameResult(nextResult) {
      frameResult = clone(nextResult);
    },
    setTab(nextTab) {
      tab = clone(nextTab);
    },
    syncStore
  };
}

function defaultFrame(position, episode, url) {
  return {
    activeEpisodeText: `第 ${episode} 集`,
    adDetected: false,
    adReason: "",
    currentTime: position,
    duration: 2700,
    ended: false,
    frameTitle: `庆余年 第${episode}集 - 腾讯视频`,
    hasVideo: true,
    heading: "庆余年",
    mediaSessionTitle: "",
    ogTitle: `庆余年 第${episode}集 - 腾讯视频`,
    paused: false,
    readyState: 4,
    score: 900000,
    url,
    videoHeight: 720,
    videoSource: "https://video.example.com/content/episode.mp4",
    videoWidth: 1280
  };
}

async function startDefault(harness, episodeSource) {
  return harness.send(
    {
      episodeLabel: "第 3 集",
      episodeSource: episodeSource || "auto",
      name: "庆余年",
      tabId: 7,
      type: "VT_START_TRACKING"
    },
    {}
  );
}

test("starts tracking from an iframe video result", async () => {
  const harness = createHarness();
  const result = await startDefault(harness);

  assert.equal(result.ok, true);
  assert.equal(result.deferredSync, false);
  const record = harness.syncStore[`vt.show.${result.record.id}`];
  assert.equal(record.name, "庆余年");
  assert.equal(record.episodeLabel, "第 3 集");
  assert.equal(record.position, 300);
  assert.ok(harness.localStore["vt.activeSessions.v1"][7]);
});

test("updates episode and position by re-injecting all frames", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const nextUrl = "https://v.qq.com/x/cover/abc123/ep4.html";
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "庆余年 第4集 - 腾讯视频",
    url: nextUrl
  });
  harness.setFrameResult(defaultFrame(900, 4, nextUrl));

  const result = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );

  assert.equal(result.active, true);
  const record = harness.syncStore[`vt.show.${started.session.showId}`];
  assert.equal(record.episodeLabel, "第 4 集");
  assert.equal(record.position, 900);
});

test("keeps a manually corrected episode label", async () => {
  const harness = createHarness();
  const started = await startDefault(harness, "manual");
  const nextUrl = "https://v.qq.com/x/cover/abc123/ep4.html";
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "庆余年 第4集 - 腾讯视频",
    url: nextUrl
  });
  harness.setFrameResult(defaultFrame(900, 4, nextUrl));

  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});

  const record = harness.syncStore[`vt.show.${started.session.showId}`];
  assert.equal(record.episodeLabel, "第 3 集");
  assert.equal(record.position, 900);
});

test("pins shows and preserves pin state across progress updates", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const showId = started.record.id;
  const initialUpdatedAt = harness.syncStore[`vt.show.${showId}`].updatedAt;

  const pinned = await harness.send(
    {
      id: showId,
      pinned: true,
      type: "VT_SET_SHOW_PINNED"
    },
    {}
  );
  assert.equal(pinned.ok, true);
  assert.equal(harness.syncStore[`vt.show.${showId}`].pinned, true);
  assert.ok(
    harness.syncStore[`vt.show.${showId}`].updatedAt > initialUpdatedAt
  );

  harness.advanceTime(16000);
  harness.setFrameResult(defaultFrame(600, 3, harness.syncStore[`vt.show.${showId}`].url));
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});

  const updated = harness.syncStore[`vt.show.${showId}`];
  assert.equal(updated.position, 600);
  assert.equal(updated.pinned, true);

  await harness.send({ tabId: 7, type: "VT_STOP_TRACKING" }, {});
  harness.advanceTime(1000);
  harness.setFrameResult(defaultFrame(700, 3, updated.url));
  await startDefault(harness);
  assert.equal(harness.syncStore[`vt.show.${showId}`].pinned, true);

  const appState = await harness.send({ tabId: 7, type: "VT_GET_APP_STATE" }, {});
  assert.equal(appState.records[0].id, showId);
  assert.equal(appState.records[0].pinned, true);
  const updatedBeforeUnpin =
    harness.syncStore[`vt.show.${showId}`].updatedAt;

  const unpinned = await harness.send(
    {
      id: showId,
      pinned: false,
      type: "VT_SET_SHOW_PINNED"
    },
    {}
  );
  assert.equal(unpinned.ok, true);
  assert.equal(harness.syncStore[`vt.show.${showId}`].pinned, false);
  assert.equal(harness.syncStore[`vt.show.${showId}`].pinnedAt, 0);
  assert.ok(
    harness.syncStore[`vt.show.${showId}`].updatedAt > updatedBeforeUnpin
  );
});

test("ignores explicit advertisement signals without changing progress", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const showId = started.record.id;
  const before = clone(harness.syncStore[`vt.show.${showId}`]);

  harness.advanceTime(16000);
  harness.setFrameResult({
    ...defaultFrame(20, 3, before.url),
    adDetected: true,
    adReason: "overlay",
    videoSource: "https://video.example.com/ad/clip.mp4"
  });

  const result = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  const after = harness.syncStore[`vt.show.${showId}`];
  assert.equal(result.guard, "advertisement");
  assert.equal(result.written, false);
  assert.equal(after.position, before.position);
  assert.equal(after.duration, before.duration);
});

test("ignores short Tencent ad videos after content starts", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const showId = started.record.id;
  const before = clone(harness.syncStore[`vt.show.${showId}`]);

  harness.advanceTime(16000);
  harness.setFrameResult({
    ...defaultFrame(12, 3, before.url),
    duration: 30,
    videoSource: "https://video.example.com/content/episode.mp4"
  });

  const result = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  const after = harness.syncStore[`vt.show.${showId}`];
  assert.equal(result.guard, "advertisement");
  assert.equal(result.reason, "short-duration");
  assert.equal(after.position, before.position);
  assert.equal(after.duration, before.duration);
});

test("waits through a preroll ad before creating the first record", async () => {
  const harness = createHarness();
  const url = "https://v.qq.com/x/cover/abc123/ep3.html";
  harness.setFrameResult({
    ...defaultFrame(8, 3, url),
    duration: 30,
    videoSource: "https://video.example.com/ad/preroll.mp4"
  });

  const started = await startDefault(harness);
  assert.equal(started.advertisement, true);
  assert.equal(started.ok, true);
  assert.equal(
    Object.keys(harness.syncStore).some((key) => key.startsWith("vt.show.")),
    false
  );

  harness.advanceTime(7000);
  harness.setFrameResult(defaultFrame(5, 3, url));
  const result = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  const record = harness.syncStore[`vt.show.${started.session.showId}`];
  assert.equal(result.written, true);
  assert.equal(record.position, 5);
  assert.equal(record.duration, 2700);
});

test("requires stable duration before accepting a changed source", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const showId = started.record.id;
  const url = harness.syncStore[`vt.show.${showId}`].url;
  const changedSource = {
    ...defaultFrame(400, 3, url),
    duration: 3600,
    videoSource: "https://video.example.com/content/episode-hd.mp4"
  };

  harness.advanceTime(16000);
  harness.setFrameResult(changedSource);
  const guarded = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  assert.equal(guarded.guard, "advertisement");
  assert.equal(guarded.reason, "unstable-source");

  harness.advanceTime(3000);
  harness.setFrameResult(changedSource);
  const stillGuarded = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  assert.equal(stillGuarded.reason, "unstable-source");

  harness.advanceTime(4000);
  harness.setFrameResult(changedSource);
  const accepted = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  assert.equal(accepted.written, true);
  assert.equal(harness.syncStore[`vt.show.${showId}`].duration, 3600);
});

test("falls back to local storage when browser sync rejects a write", async () => {
  const harness = createHarness({ syncSetError: "quota exceeded" });
  const result = await startDefault(harness);

  assert.equal(result.ok, true);
  assert.equal(result.deferredSync, true);
  assert.ok(harness.localStore[`vt.local.show.${result.record.id}`]);
  assert.ok(harness.localStore["vt.syncIssue"]);
});

test("saves the latest position when tracking stops", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  harness.setFrameResult(
    defaultFrame(1200, 3, "https://v.qq.com/x/cover/abc123/ep3.html")
  );

  const stopped = await harness.send(
    { tabId: 7, type: "VT_STOP_TRACKING" },
    {}
  );

  assert.equal(stopped.ok, true);
  assert.equal(harness.localStore["vt.activeSessions.v1"][7], undefined);
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].position,
    1200
  );
});

test("marks an episode complete after naturally watching 80 percent", async () => {
  const harness = createHarness();
  const url = "https://v.qq.com/x/cover/movie/ep-movie.html";
  const lesson = {
    ...defaultFrame(0, 1, url),
    duration: 600,
    frameTitle: "测试动画电影 第1集 - 腾讯视频",
    heading: "测试动画电影",
    ogTitle: "测试动画电影 第1集 - 腾讯视频"
  };
  harness.setFrameResult(lesson);
  const started = await harness.send(
    {
      episodeLabel: "第 1 集",
      episodeSource: "auto",
      name: "测试动画电影",
      tabId: 7,
      type: "VT_START_TRACKING"
    },
    {}
  );

  for (let position = 30; position <= 480; position += 30) {
    harness.advanceTime(30000);
    harness.setFrameResult({
      ...lesson,
      currentTime: position
    });
    await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  }

  const show = harness.syncStore[`vt.show.${started.record.id}`];
  const episodeKey = Object.keys(harness.syncStore).find((key) =>
    key.startsWith("vt.episode.")
  );
  assert.equal(show.episodeCompleted, true);
  assert.equal(harness.syncStore[episodeKey].completed, true);
  assert.equal(show.position, 480);
});

test("does not mark an episode complete after seeking to 83 percent", async () => {
  const harness = createHarness();
  const url = "https://v.qq.com/x/cover/movie/ep-movie.html";
  const lesson = {
    ...defaultFrame(0, 1, url),
    duration: 600,
    frameTitle: "测试动画电影 第1集 - 腾讯视频",
    heading: "测试动画电影",
    ogTitle: "测试动画电影 第1集 - 腾讯视频"
  };
  harness.setFrameResult(lesson);
  const started = await harness.send(
    {
      episodeLabel: "第 1 集",
      episodeSource: "auto",
      name: "测试动画电影",
      tabId: 7,
      type: "VT_START_TRACKING"
    },
    {}
  );

  harness.advanceTime(1000);
  harness.setFrameResult({
    ...lesson,
    currentTime: 500
  });
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  await harness.send({ tabId: 7, type: "VT_STOP_TRACKING" }, {});

  const show = harness.syncStore[`vt.show.${started.record.id}`];
  const episodeKey = Object.keys(harness.syncStore).find((key) =>
    key.startsWith("vt.episode.")
  );
  assert.equal(show.episodeCompleted, false);
  assert.equal(harness.syncStore[episodeKey].completed, false);
});

test("stops tracking when the tab switches to another show", async () => {
  const harness = createHarness();
  await startDefault(harness);
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "另一部剧 第1集 - 腾讯视频",
    url: "https://v.qq.com/x/cover/another/ep1.html"
  });
  harness.setFrameResult({
    ...defaultFrame(60, 1, "https://v.qq.com/x/cover/another/ep1.html"),
    frameTitle: "另一部剧 第1集 - 腾讯视频",
    heading: "另一部剧",
    ogTitle: "另一部剧 第1集 - 腾讯视频"
  });

  const result = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );

  assert.equal(result.active, false);
  assert.equal(result.reason, "series-changed");
  assert.equal(harness.localStore["vt.activeSessions.v1"][7], undefined);
});

test("automatically resumes tracking for a known show in a new tab", async () => {
  const url = "https://v.qq.com/x/cover/abc123/ep3.html";
  const frame = defaultFrame(300, 3, url);
  const record = knownRecordForFrame(frame, "庆余年");
  const harness = createHarness({
    syncStore: {
      [`vt.show.${record.id}`]: record
    }
  });

  const state = await harness.send(
    { tabId: 7, type: "VT_GET_APP_STATE" },
    {}
  );
  assert.equal(state.session.autoResumed, true);
  assert.equal(state.session.showId, record.id);

  harness.advanceTime(16000);
  harness.setFrameResult(defaultFrame(420, 3, url));
  const synced = await harness.send(
    { tabId: 7, type: "VT_SYNC_TAB" },
    {}
  );
  assert.equal(synced.written, true);
  assert.equal(harness.syncStore[`vt.show.${record.id}`].position, 420);
});

test("does not auto-resume a show after the user explicitly stops", async () => {
  const url = "https://v.qq.com/x/cover/abc123/ep3.html";
  const frame = defaultFrame(300, 3, url);
  const record = knownRecordForFrame(frame, "庆余年");
  const harness = createHarness({
    syncStore: {
      [`vt.show.${record.id}`]: record
    }
  });

  const resumed = await harness.send(
    { tabId: 7, type: "VT_GET_APP_STATE" },
    {}
  );
  assert.equal(resumed.session.showId, record.id);

  await harness.send({ tabId: 7, type: "VT_STOP_TRACKING" }, {});
  const stopped = await harness.send(
    { tabId: 7, type: "VT_GET_APP_STATE" },
    {}
  );
  assert.equal(stopped.session, null);
  assert.equal(
    harness.localStore["vt.trackingSuppressions.v1"][7].seriesKey,
    record.seriesKey
  );

  await startDefault(harness);
  const restarted = await harness.send(
    { tabId: 7, type: "VT_GET_APP_STATE" },
    {}
  );
  assert.equal(restarted.session.showId, record.id);
});

test("returns per-episode history for the management page", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const library = await harness.send(
    { type: "VT_GET_LIBRARY_STATE" },
    {}
  );

  assert.equal(library.ok, true);
  assert.equal(library.shows.length, 1);
  assert.equal(library.episodes.length, 1);
  assert.equal(library.episodes[0].showId, started.record.id);
  assert.equal(library.episodes[0].episodeLabel, "第 3 集");
  assert.equal(library.episodes[0].position, 300);
});

test("delays a lower playback position until one minute is watched", async () => {
  const harness = createHarness();
  const url = "https://v.qq.com/x/cover/abc123/ep3.html";
  harness.setFrameResult(defaultFrame(1200, 3, url));
  const started = await startDefault(harness);

  harness.advanceTime(10000);
  harness.setFrameResult({ ...defaultFrame(600, 3, url), paused: false });
  const first = await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  assert.equal(first.guard, "position-regression");
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].position,
    1200
  );

  harness.advanceTime(30000);
  harness.setFrameResult({ ...defaultFrame(630, 3, url), paused: false });
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].position,
    1200
  );

  harness.advanceTime(31000);
  harness.setFrameResult({ ...defaultFrame(661, 3, url), paused: false });
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].position,
    661
  );
});

test("delays switching to a smaller episode until one minute is watched", async () => {
  const harness = createHarness();
  const episode101Url = "https://v.qq.com/x/cover/abc123/ep101.html";
  const episode100Url = "https://v.qq.com/x/cover/abc123/ep100.html";
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "沧元图 101集 - 腾讯视频",
    url: episode101Url
  });
  harness.setFrameResult(defaultFrame(1400, 101, episode101Url));
  const started = await harness.send(
    {
      episodeLabel: "第 101 集",
      episodeSource: "auto",
      name: "沧元图",
      tabId: 7,
      type: "VT_START_TRACKING"
    },
    {}
  );

  harness.advanceTime(10000);
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "沧元图 100集 - 腾讯视频",
    url: episode100Url
  });
  harness.setFrameResult(defaultFrame(20, 100, episode100Url));
  const first = await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  assert.equal(first.guard, "episode-regression");
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].episodeLabel,
    "第 101 集"
  );

  harness.advanceTime(30000);
  harness.setFrameResult(defaultFrame(50, 100, episode100Url));
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  assert.equal(
    harness.syncStore[`vt.show.${started.record.id}`].episodeLabel,
    "第 101 集"
  );

  harness.advanceTime(31000);
  harness.setFrameResult(defaultFrame(81, 100, episode100Url));
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});
  const record = harness.syncStore[`vt.show.${started.record.id}`];
  assert.equal(record.episodeLabel, "第 100 集");
  assert.equal(record.position, 81);
});

test("stores the watching device name and local IP on each episode", async () => {
  const harness = createHarness({
    localStore: {
      "vt.deviceProfile.v1": {
        browser: "Microsoft Edge",
        customName: true,
        id: "device-study",
        localIp: "10.95.8.33",
        name: "书房电脑",
        networkUpdatedAt: Date.now(),
        platform: "Windows",
        publicIp: "36.110.12.34",
        publicIpProvider: "ipify",
        publicIpUpdatedAt: Date.now(),
        updatedAt: Date.now()
      }
    }
  });
  await startDefault(harness);
  const episodeKey = Object.keys(harness.syncStore).find((key) =>
    key.startsWith("vt.episode.")
  );
  const episode = harness.syncStore[episodeKey];

  assert.equal(episode.deviceName, "书房电脑");
  assert.equal(episode.deviceIp, "10.95.8.33");
  assert.equal(episode.devicePublicIp, "36.110.12.34");
  assert.equal(episode.deviceBrowser, "Microsoft Edge");
});

function syncRecord(showId, updatedAt, name) {
  return {
    duration: 2700,
    episodeCompleted: false,
    episodeLabel: "第 3 集",
    episodeSource: "auto",
    id: showId,
    name,
    pageTitle: `${name} 第3集`,
    position: 300,
    progress: 11.1,
    seriesKey: `generic:${name}`,
    site: "generic",
    siteLabel: "测试站",
    updatedAt,
    url: "https://example.com/ep3",
    version: 2
  };
}

function knownRecordForFrame(frame, name) {
  const title = Core.cleanSeriesTitle(frame.frameTitle);
  const seriesKey = Core.deriveSeriesKey(frame.url, title);
  const showId = Core.createShowId(seriesKey);
  return {
    ...syncRecord(showId, 1000, name || title),
    episodeLabel: "第 3 集",
    pageTitle: frame.frameTitle,
    seriesKey,
    site: "tencent",
    siteLabel: "腾讯视频",
    title,
    url: frame.url
  };
}

test("pulls newer cloud data into the local mirror", async () => {
  const showId = "show_cloud_newer";
  const harness = createHarness({
    localStore: {
      [`vt.local.show.${showId}`]: syncRecord(
        showId,
        1000,
        "旧本地记录"
      )
    },
    syncStore: {
      [`vt.show.${showId}`]: syncRecord(showId, 2000, "云端新记录")
    }
  });

  const state = await harness.send({ type: "VT_SYNC_NOW" }, {});
  assert.equal(state.status, "synced");
  assert.equal(state.pending, 0);
  assert.equal(
    harness.localStore[`vt.local.show.${showId}`].name,
    "云端新记录"
  );
  assert.equal(
    harness.syncStore[`vt.show.${showId}`].name,
    "云端新记录"
  );
});

test("pushes newer local data without overwriting newer cloud data", async () => {
  const newerId = "show_local_newer";
  const olderId = "show_cloud_newer";
  const harness = createHarness({
    localStore: {
      [`vt.local.show.${newerId}`]: syncRecord(newerId, 3000, "本地新记录"),
      [`vt.local.show.${olderId}`]: syncRecord(olderId, 1000, "旧本地记录")
    },
    syncStore: {
      [`vt.show.${newerId}`]: syncRecord(newerId, 2000, "旧云端记录"),
      [`vt.show.${olderId}`]: syncRecord(olderId, 4000, "云端新记录")
    }
  });

  const state = await harness.send({ type: "VT_SYNC_NOW" }, {});
  assert.equal(state.status, "synced");
  assert.equal(state.pending, 0);
  assert.equal(
    harness.syncStore[`vt.show.${newerId}`].name,
    "本地新记录"
  );
  assert.equal(
    harness.syncStore[`vt.show.${olderId}`].name,
    "云端新记录"
  );
});

test("lists devices and supports renaming local or remote devices", async () => {
  const profile = {
    browser: "Microsoft Edge",
    customName: true,
    id: "device-a",
    localIp: "10.95.8.33",
    name: "书房电脑",
    nameUpdatedAt: 1000,
    networkUpdatedAt: Date.now(),
    platform: "Windows",
    updatedAt: Date.now()
  };
  const harness = createHarness({
    localStore: {
      "vt.deviceProfile.v1": profile
    },
    syncStore: {
      "vt.device.device-b": {
        browser: "Google Chrome",
        checkpoint: 1000,
        id: "device-b",
        lastSeenAt: 1000,
        localIp: "192.168.1.20",
        name: "办公室电脑",
        nameUpdatedAt: 1000,
        platform: "Windows",
        updatedAt: 1000,
        version: 2
      }
    }
  });

  const list = await harness.send({ type: "VT_GET_DEVICE_LIST" }, {});
  assert.equal(list.devices.length, 2);
  assert.equal(list.devices.some((device) => device.current), true);

  const renamedRemote = await harness.send(
    {
      deviceId: "device-b",
      name: "客厅电脑",
      type: "VT_RENAME_DEVICE"
    },
    {}
  );
  assert.equal(
    renamedRemote.devices.find((device) => device.id === "device-b").name,
    "客厅电脑"
  );

  const renamedCurrent = await harness.send(
    {
      deviceId: "device-a",
      name: "书房主机",
      type: "VT_RENAME_DEVICE"
    },
    {}
  );
  assert.equal(renamedCurrent.device.name, "书房主机");
  assert.equal(
    harness.localStore["vt.deviceProfile.v1"].name,
    "书房主机"
  );
});

test("exports and imports a JSON-compatible backup", async () => {
  const source = createHarness();
  await startDefault(source);
  const exported = await source.send({ type: "VT_EXPORT_BACKUP" }, {});

  assert.equal(exported.ok, true);
  assert.equal(exported.backup.shows.length, 1);
  assert.equal(exported.backup.episodes.length, 1);

  const target = createHarness();
  const imported = await target.send(
    {
      backup: exported.backup,
      type: "VT_IMPORT_BACKUP"
    },
    {}
  );
  assert.equal(imported.ok, true);
  assert.equal(imported.shows, 1);
  assert.equal(imported.episodes, 1);

  const library = await target.send({ type: "VT_GET_LIBRARY_STATE" }, {});
  assert.equal(library.shows[0].name, "庆余年");
  assert.equal(library.episodes[0].episodeLabel, "第 3 集");
});

test("deletes one episode without removing later history", async () => {
  const harness = createHarness();
  await startDefault(harness);
  const nextUrl = "https://v.qq.com/x/cover/abc123/ep4.html";
  harness.setTab({
    active: true,
    audible: true,
    id: 7,
    title: "庆余年 第4集 - 腾讯视频",
    url: nextUrl
  });
  harness.setFrameResult(defaultFrame(900, 4, nextUrl));
  await harness.send({ tabId: 7, type: "VT_SYNC_TAB" }, {});

  const library = await harness.send({ type: "VT_GET_LIBRARY_STATE" }, {});
  const episode3 = library.episodes.find(
    (episode) => episode.episodeLabel === "第 3 集"
  );
  const deleted = await harness.send(
    {
      episodeId: episode3.id,
      showId: episode3.showId,
      storageKey: episode3.storageKey,
      type: "VT_DELETE_EPISODE"
    },
    {}
  );

  assert.equal(deleted.ok, true);
  assert.equal(deleted.showDeleted, false);
  const after = await harness.send({ type: "VT_GET_LIBRARY_STATE" }, {});
  assert.equal(after.episodes.some((episode) => episode.episodeLabel === "第 3 集"), false);
  assert.equal(after.episodes.some((episode) => episode.episodeLabel === "第 4 集"), true);
  assert.equal(after.shows[0].episodeLabel, "第 4 集");
});

test("deletes a show and all of its episode records", async () => {
  const harness = createHarness();
  const started = await startDefault(harness);
  const deleted = await harness.send(
    { id: started.record.id, type: "VT_DELETE_SHOW" },
    {}
  );

  assert.equal(deleted.ok, true);
  const library = await harness.send({ type: "VT_GET_LIBRARY_STATE" }, {});
  assert.equal(library.shows.length, 0);
  assert.equal(library.episodes.length, 0);
});
