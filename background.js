importScripts("core.js");

const Core = self.VideoTrackerCore;
const ACTIVE_SESSIONS_KEY = "vt.activeSessions.v1";
const DEVICE_PROFILE_KEY = "vt.deviceProfile.v1";
const DEVICE_SYNC_PREFIX = "vt.device.";
const EPISODE_LOCAL_PREFIX = "vt.local.episode.";
const EPISODE_SYNC_PREFIX = "vt.episode.";
const LOCAL_SCHEMA_KEY = "vt.schemaVersion";
const LOCAL_SHOW_PREFIX = "vt.local.show.";
const SYNC_ISSUE_KEY = "vt.syncIssue";
const SYNC_SHOW_PREFIX = "vt.show.";
const TRACKING_ALARM = "vt.trackingHeartbeat";
const SCHEMA_VERSION = 2;
const SYNC_INTERVAL_MS = 15000;
const SNAPSHOT_CACHE_MS = 700;
const ALARM_PERIOD_MINUTES = 0.5;
const REGRESSION_CONFIRM_MS = 60000;
const MAX_WATCH_SAMPLE_MS = 45000;
const POSITION_REGRESSION_TOLERANCE_SEC = 15;
const DEVICE_HEARTBEAT_INTERVAL_MS = 60000;

let sessionsCache = null;
let sessionsLoading = null;
const snapshotCache = new Map();

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function storageSet(area, values) {
  return new Promise((resolve, reject) => {
    area.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(area, keys) {
  return new Promise((resolve, reject) => {
    area.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function executeScript(details) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(details, (results) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(results || []);
    });
  });
}

function setBadge(tabId, active) {
  if (!tabId) {
    return;
  }

  try {
    chrome.action.setBadgeBackgroundColor({ color: "#f4b860", tabId });
    chrome.action.setBadgeText({ tabId, text: active ? "ON" : "" });
  } catch (_error) {
    // The tab may disappear between a message and this visual update.
  }
}

async function loadSessions() {
  if (sessionsCache) {
    return sessionsCache;
  }

  if (!sessionsLoading) {
    sessionsLoading = storageGet(chrome.storage.local, ACTIVE_SESSIONS_KEY)
      .then((result) => {
        const stored = result[ACTIVE_SESSIONS_KEY];
        sessionsCache = stored && typeof stored === "object" ? stored : {};
        return sessionsCache;
      })
      .finally(() => {
        sessionsLoading = null;
      });
  }

  return sessionsLoading;
}

async function saveSessions() {
  await storageSet(chrome.storage.local, {
    [ACTIVE_SESSIONS_KEY]: sessionsCache || {}
  });
}

function syncKeyFor(showId) {
  return `${SYNC_SHOW_PREFIX}${showId}`;
}

function localKeyFor(showId) {
  return `${LOCAL_SHOW_PREFIX}${showId}`;
}

function episodeIdFor(showId, identity) {
  return `${showId}.${Core.createShowId(`${showId}|${identity}`).replace(/^show_/, "")}`;
}

function syncKeyForEpisode(episodeId) {
  return `${EPISODE_SYNC_PREFIX}${episodeId}`;
}

function localKeyForEpisode(episodeId) {
  return `${EPISODE_LOCAL_PREFIX}${episodeId}`;
}

function limitText(value, maximum) {
  return Core.normalizeText(value).slice(0, maximum);
}

function sanitizeRecord(record) {
  return {
    duration: Math.max(0, Number(record.duration) || 0),
    episodeCompleted: Boolean(record.episodeCompleted),
    episodeLabel: limitText(record.episodeLabel, 40),
    episodeSource: record.episodeSource === "manual" ? "manual" : "auto",
    id: limitText(record.id, 80),
    name: limitText(record.name, 100) || "未命名剧集",
    pageTitle: limitText(record.pageTitle, 300),
    position: Math.max(0, Number(record.position) || 0),
    progress: Core.calculateProgress(record.position, record.duration),
    seriesKey: limitText(record.seriesKey, 240),
    site: limitText(record.site, 40) || "generic",
    siteLabel: limitText(record.siteLabel, 40) || "网页视频",
    updatedAt: Number(record.updatedAt) || Date.now(),
    url: String(record.url || "").slice(0, 1800),
    version: SCHEMA_VERSION
  };
}

function sanitizeEpisodeRecord(record) {
  return {
    completed: Boolean(record.completed),
    deviceBrowser: limitText(record.deviceBrowser, 40),
    deviceId: limitText(record.deviceId, 80),
    deviceIp: limitText(record.deviceIp, 60),
    deviceName: limitText(record.deviceName, 80),
    devicePlatform: limitText(record.devicePlatform, 40),
    devicePublicIp: limitText(record.devicePublicIp, 80),
    duration: Math.max(0, Number(record.duration) || 0),
    episodeLabel: limitText(record.episodeLabel, 40),
    firstSeenAt: Number(record.firstSeenAt) || Date.now(),
    id: limitText(record.id, 180),
    pageTitle: limitText(record.pageTitle, 300),
    position: Math.max(0, Number(record.position) || 0),
    progress: Core.calculateProgress(record.position, record.duration),
    showId: limitText(record.showId, 80),
    updatedAt: Number(record.updatedAt) || Date.now(),
    url: String(record.url || "").slice(0, 1800),
    version: SCHEMA_VERSION
  };
}

function recordFromSnapshot(snapshot, options) {
  const now = Date.now();
  const episodeSource = options.episodeSource === "manual" ? "manual" : "auto";
  const episodeLabel =
    episodeSource === "manual"
      ? limitText(options.episodeLabel, 40)
      : limitText(snapshot.episodeLabel || options.episodeLabel, 40);

  return sanitizeRecord({
    duration: snapshot.duration,
    episodeCompleted: false,
    episodeLabel,
    episodeSource,
    id: options.id,
    name: limitText(options.name, 100) || snapshot.title,
    pageTitle: snapshot.pageTitle,
    position: snapshot.currentTime,
    seriesKey: snapshot.seriesKey,
    site: snapshot.site,
    siteLabel: snapshot.siteLabel,
    updatedAt: now,
    url: snapshot.url
  });
}

async function getLocalDeviceProfile() {
  const result = await storageGet(chrome.storage.local, DEVICE_PROFILE_KEY).catch(
    () => ({})
  );
  const stored = result[DEVICE_PROFILE_KEY];
  if (stored && stored.id) {
    return stored;
  }

  const profile = {
    browser: "Chromium",
    customName: false,
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `device-${Date.now().toString(36)}`,
    localIp: "",
    publicIp: "",
    name: "未命名设备",
    nameUpdatedAt: 0,
    networkUpdatedAt: 0,
    platform: "未知平台",
    updatedAt: Date.now()
  };
  await storageSet(chrome.storage.local, {
    [DEVICE_PROFILE_KEY]: profile
  }).catch(() => {});
  return profile;
}

function deviceSyncKey(deviceId) {
  return `${DEVICE_SYNC_PREFIX}${deviceId}`;
}

function buildDeviceList(profile, syncResult) {
  const devicesById = new Map();
  for (const [key, value] of Object.entries(syncResult || {})) {
    if (key.startsWith(DEVICE_SYNC_PREFIX) && value && value.id) {
      devicesById.set(value.id, {
        browser: value.browser || "",
        id: value.id,
        lastSeenAt: Number(value.lastSeenAt) || 0,
        localIp: value.localIp || "",
        name: value.name || "未命名设备",
        nameUpdatedAt: Number(value.nameUpdatedAt) || 0,
        platform: value.platform || "",
        publicIp: value.publicIp || "",
        storageKey: key
      });
    }
  }
  devicesById.set(profile.id, {
    browser: profile.browser || "",
    id: profile.id,
    lastSeenAt: Number(
      devicesById.get(profile.id)?.lastSeenAt || profile.updatedAt || 0
    ),
    localIp: profile.localIp || "",
    name: profile.name || "未命名设备",
    nameUpdatedAt: Number(profile.nameUpdatedAt) || 0,
    platform: profile.platform || "",
    publicIp: profile.publicIp || "",
    storageKey: deviceSyncKey(profile.id),
    current: true
  });

  return Array.from(devicesById.values()).sort((left, right) => {
    if (left.current) {
      return -1;
    }
    if (right.current) {
      return 1;
    }
    return Number(right.lastSeenAt) - Number(left.lastSeenAt);
  });
}

async function touchDeviceHeartbeat(options) {
  const settings = options || {};
  let profile = await getLocalDeviceProfile();
  const syncResult = await storageGet(chrome.storage.sync, null).catch(() => ({}));
  const ownKey = deviceSyncKey(profile.id);
  const previousOwn = syncResult[ownKey];
  const now = Date.now();
  if (
    previousOwn &&
    Number(previousOwn.nameUpdatedAt) > Number(profile.nameUpdatedAt || 0)
  ) {
    profile = {
      ...profile,
      customName: true,
      name: previousOwn.name || profile.name,
      nameUpdatedAt: Number(previousOwn.nameUpdatedAt),
      updatedAt: now
    };
    await storageSet(chrome.storage.local, {
      [DEVICE_PROFILE_KEY]: profile
    }).catch(() => {});
  }

  if (
    settings.force ||
    !previousOwn ||
    now - Number(previousOwn.checkpoint || 0) >= DEVICE_HEARTBEAT_INTERVAL_MS
  ) {
    const record = {
      browser: limitText(profile.browser, 40),
      checkpoint: now,
      id: limitText(profile.id, 80),
      lastSeenAt: now,
      localIp: limitText(profile.localIp, 60),
      name: limitText(profile.name, 80) || "未命名设备",
      nameUpdatedAt: Number(profile.nameUpdatedAt) || now,
      platform: limitText(profile.platform, 40),
      publicIp: limitText(profile.publicIp, 80),
      updatedAt: now,
      version: SCHEMA_VERSION
    };

    await storageSet(chrome.storage.sync, { [ownKey]: record });
    syncResult[ownKey] = record;
  }

  return {
    device: profile,
    devices: buildDeviceList(profile, syncResult)
  };
}

async function renameDevice(message) {
  const deviceId = limitText(message.deviceId, 80);
  const name = limitText(message.name, 80);
  if (!deviceId || !name) {
    throw new Error("设备名称无效");
  }

  let profile = await getLocalDeviceProfile();
  const now = Date.now();
  if (deviceId === profile.id) {
    profile = {
      ...profile,
      customName: true,
      name,
      nameUpdatedAt: now,
      updatedAt: now
    };
    await storageSet(chrome.storage.local, {
      [DEVICE_PROFILE_KEY]: profile
    });
  }

  const syncResult = await storageGet(chrome.storage.sync, null).catch(() => ({}));
  const key = deviceSyncKey(deviceId);
  const existing = syncResult[key];
  if (!existing && deviceId !== profile.id) {
    throw new Error("设备记录不存在");
  }
  const record = {
    browser: limitText(existing?.browser || profile.browser, 40),
    checkpoint: Number(existing?.checkpoint) || now,
    id: deviceId,
    lastSeenAt: Number(existing?.lastSeenAt) || now,
    localIp: limitText(existing?.localIp || profile.localIp, 60),
    name,
    nameUpdatedAt: now,
    platform: limitText(existing?.platform || profile.platform, 40),
    publicIp: limitText(existing?.publicIp || profile.publicIp, 80),
    updatedAt: now,
    version: SCHEMA_VERSION
  };
  await storageSet(chrome.storage.sync, { [key]: record });
  syncResult[key] = record;

  return {
    device: profile,
    devices: buildDeviceList(profile, syncResult)
  };
}

function episodeRecordFromSnapshot(record, snapshot, existing, device) {
  const episodeLabel =
    record.episodeSource === "manual"
      ? record.episodeLabel
      : snapshot.episodeLabel || record.episodeLabel;
  const identity =
    Core.normalizeText(episodeLabel) ||
    Core.normalizeText(snapshot.url) ||
    Core.normalizeText(record.url) ||
    "episode";
  const episodeId = episodeIdFor(record.id, identity);

  return sanitizeEpisodeRecord({
    completed:
      Boolean(snapshot.ended) ||
      (snapshot.duration > 0 &&
        snapshot.duration - snapshot.currentTime <= 1),
    deviceBrowser: device.browser,
    deviceId: device.id,
    deviceIp: device.localIp,
    deviceName: device.name,
    devicePlatform: device.platform,
    devicePublicIp: device.publicIp,
    duration: snapshot.duration || record.duration,
    episodeLabel,
    firstSeenAt: existing ? existing.firstSeenAt : Date.now(),
    id: episodeId,
    pageTitle: snapshot.pageTitle || record.pageTitle,
    position: snapshot.currentTime,
    showId: record.id,
    updatedAt: Date.now(),
    url: snapshot.url || record.url
  });
}

async function getEpisodeRecord(episodeId) {
  const syncKey = syncKeyForEpisode(episodeId);
  const localKey = localKeyForEpisode(episodeId);
  const [syncResult, localResult] = await Promise.all([
    storageGet(chrome.storage.sync, syncKey).catch(() => ({})),
    storageGet(chrome.storage.local, localKey).catch(() => ({}))
  ]);
  const synced = syncResult[syncKey];
  const local = localResult[localKey];

  if (synced && local) {
    return Number(local.updatedAt) > Number(synced.updatedAt) ? local : synced;
  }
  return synced || local || null;
}

async function setSyncIssue(error) {
  const value =
    error == null
      ? null
      : {
          at: Date.now(),
          message: limitText(error.message || String(error), 200)
        };
  try {
    await storageSet(chrome.storage.local, { [SYNC_ISSUE_KEY]: value });
  } catch (_storageError) {
    // Never let a sync status update interrupt playback tracking.
  }
}

async function writeRecord(record, episodeRecord) {
  const normalized = sanitizeRecord(record);
  const episode = episodeRecord
    ? sanitizeEpisodeRecord(episodeRecord)
    : null;
  const localValues = {
    [localKeyFor(normalized.id)]: normalized
  };
  if (episode) {
    localValues[localKeyForEpisode(episode.id)] = episode;
  }
  await storageSet(chrome.storage.local, localValues);

  const syncValues = {
    [syncKeyFor(normalized.id)]: normalized
  };
  if (episode) {
    syncValues[syncKeyForEpisode(episode.id)] = episode;
  }

  try {
    await storageSet(chrome.storage.sync, syncValues);
    await setSyncIssue(null);
    return { episode, record: normalized, synced: true };
  } catch (error) {
    await setSyncIssue(error);
    return { episode, record: normalized, synced: false };
  }
}

async function getRecord(showId) {
  const key = syncKeyFor(showId);
  const localKey = localKeyFor(showId);
  const [syncResult, localResult] = await Promise.all([
    storageGet(chrome.storage.sync, key).catch(() => ({})),
    storageGet(chrome.storage.local, localKey).catch(() => ({}))
  ]);
  const synced = syncResult[key];
  const local = localResult[localKey];

  if (synced && local) {
    return Number(local.updatedAt) > Number(synced.updatedAt) ? local : synced;
  }
  return synced || local || null;
}

function collectRecords(stored, prefix) {
  const records = [];
  for (const [key, value] of Object.entries(stored || {})) {
    if (key.startsWith(prefix) && value && value.id) {
      records.push(value);
    }
  }
  return records;
}

function collectEpisodes(stored, prefix) {
  const episodes = [];
  for (const [key, value] of Object.entries(stored || {})) {
    if (key.startsWith(prefix) && value && value.id && value.showId) {
      episodes.push({
        ...value,
        storageKey: key
      });
    }
  }
  return episodes;
}

async function readLocalShows() {
  const result = await storageGet(chrome.storage.local, null);
  return collectRecords(result, LOCAL_SHOW_PREFIX);
}

async function readLocalEpisodes() {
  const result = await storageGet(chrome.storage.local, null);
  return collectEpisodes(result, EPISODE_LOCAL_PREFIX);
}

function buildCloudMergePayload(syncData, localData) {
  const payload = {};
  let pending = 0;

  for (const record of collectRecords(localData, LOCAL_SHOW_PREFIX)) {
    const normalized = sanitizeRecord(record);
    const key = syncKeyFor(normalized.id);
    const cloudRecord = syncData[key];
    if (
      !cloudRecord ||
      Number(normalized.updatedAt) > Number(cloudRecord.updatedAt)
    ) {
      payload[key] = normalized;
      pending += 1;
    }
  }

  for (const episode of collectEpisodes(localData, EPISODE_LOCAL_PREFIX)) {
    const normalized = sanitizeEpisodeRecord(episode);
    const key = syncKeyForEpisode(normalized.id);
    const cloudRecord = syncData[key];
    if (
      !cloudRecord ||
      Number(normalized.updatedAt) > Number(cloudRecord.updatedAt)
    ) {
      payload[key] = normalized;
      pending += 1;
    }
  }

  return { payload, pending };
}

function buildLocalMirrorPayload(syncData, localData) {
  const payload = {};

  for (const record of collectRecords(syncData, SYNC_SHOW_PREFIX)) {
    const normalized = sanitizeRecord(record);
    const key = localKeyFor(normalized.id);
    const localRecord = localData[key];
    if (
      !localRecord ||
      Number(normalized.updatedAt) > Number(localRecord.updatedAt)
    ) {
      payload[key] = normalized;
    }
  }

  for (const episode of collectEpisodes(syncData, EPISODE_SYNC_PREFIX)) {
    const normalized = sanitizeEpisodeRecord(episode);
    const key = localKeyForEpisode(normalized.id);
    const localRecord = localData[key];
    if (
      !localRecord ||
      Number(normalized.updatedAt) > Number(localRecord.updatedAt)
    ) {
      payload[key] = normalized;
    }
  }

  return payload;
}

async function synchronizeStorage(options) {
  const settings = options || {};
  const startedAt = Date.now();
  let syncData;
  let localData;

  try {
    [syncData, localData] = await Promise.all([
      storageGet(chrome.storage.sync, null),
      storageGet(chrome.storage.local, null)
    ]);
  } catch (error) {
    await setSyncIssue(error);
    return {
      cloudEpisodes: 0,
      cloudShows: 0,
      devices: [],
      error: error.message || String(error),
      lastSyncAt: startedAt,
      pending: 0,
      status: "error"
    };
  }

  const pullPayload = buildLocalMirrorPayload(syncData, localData);
  if (Object.keys(pullPayload).length) {
    try {
      await storageSet(chrome.storage.local, pullPayload);
      localData = { ...localData, ...pullPayload };
    } catch (error) {
      await setSyncIssue(error);
    }
  }

  let merge = buildCloudMergePayload(syncData, localData);
  if (merge.pending > 0) {
    try {
      // Pull once more immediately before writing so an older local cache
      // cannot overwrite a cloud record that arrived during the merge.
      syncData = await storageGet(chrome.storage.sync, null);
      const latestPull = buildLocalMirrorPayload(syncData, localData);
      if (Object.keys(latestPull).length) {
        await storageSet(chrome.storage.local, latestPull);
        localData = { ...localData, ...latestPull };
      }
      merge = buildCloudMergePayload(syncData, localData);
      if (merge.pending > 0) {
        await storageSet(chrome.storage.sync, merge.payload);
      }
      await setSyncIssue(null);
    } catch (error) {
      await setSyncIssue(error);
      return {
        cloudEpisodes: collectEpisodes(syncData, EPISODE_SYNC_PREFIX).length,
        cloudShows: collectRecords(syncData, SYNC_SHOW_PREFIX).length,
        devices: [],
        error: error.message || String(error),
        lastSyncAt: startedAt,
        pending: merge.pending,
        status: "error"
      };
    }
  } else {
    await setSyncIssue(null);
  }

  const deviceState = await touchDeviceHeartbeat({
    force: Boolean(settings.forceDeviceHeartbeat)
  }).catch(() => null);
  const finalSyncData = await storageGet(chrome.storage.sync, null).catch(
    () => syncData
  );
  const finalPull = buildLocalMirrorPayload(finalSyncData, localData);
  if (Object.keys(finalPull).length) {
    await storageSet(chrome.storage.local, finalPull).catch(() => {});
    localData = { ...localData, ...finalPull };
  }
  const finalMerge = buildCloudMergePayload(finalSyncData, localData);
  const localState = await storageGet(
    chrome.storage.local,
    SYNC_ISSUE_KEY
  ).catch(() => ({}));
  const syncIssue = localState[SYNC_ISSUE_KEY] || null;

  return {
    cloudEpisodes: collectEpisodes(finalSyncData, EPISODE_SYNC_PREFIX).length,
    cloudShows: collectRecords(finalSyncData, SYNC_SHOW_PREFIX).length,
    device: deviceState ? deviceState.device : null,
    devices: deviceState ? deviceState.devices : [],
    lastSyncAt: Date.now(),
    pending: finalMerge.pending,
    status: syncIssue || finalMerge.pending > 0 ? "pending" : "synced"
  };
}

async function getAllRecords() {
  const [syncResult, localResult] = await Promise.all([
    storageGet(chrome.storage.sync, null).catch(() => ({})),
    storageGet(chrome.storage.local, null).catch(() => ({}))
  ]);

  const recordsById = new Map();
  for (const record of [
    ...collectRecords(syncResult, SYNC_SHOW_PREFIX),
    ...collectRecords(localResult, LOCAL_SHOW_PREFIX)
  ]) {
    const current = recordsById.get(record.id);
    if (!current || Number(record.updatedAt) > Number(current.updatedAt)) {
      recordsById.set(record.id, sanitizeRecord(record));
    }
  }

  return Array.from(recordsById.values()).sort(
    (left, right) => Number(right.updatedAt) - Number(left.updatedAt)
  );
}

async function getAllEpisodes() {
  const [syncResult, localResult] = await Promise.all([
    storageGet(chrome.storage.sync, null).catch(() => ({})),
    storageGet(chrome.storage.local, null).catch(() => ({}))
  ]);

  const episodesById = new Map();
  for (const episode of [
    ...collectEpisodes(syncResult, EPISODE_SYNC_PREFIX),
    ...collectEpisodes(localResult, EPISODE_LOCAL_PREFIX)
  ]) {
    const current = episodesById.get(episode.id);
    if (!current || Number(episode.updatedAt) > Number(current.updatedAt)) {
      episodesById.set(episode.id, {
        ...sanitizeEpisodeRecord(episode),
        storageKey: episode.storageKey
      });
    }
  }

  return Array.from(episodesById.values()).sort(
    (left, right) => Number(right.updatedAt) - Number(left.updatedAt)
  );
}

function synthesizeCurrentEpisodes(records, episodes) {
  const existingEpisodes = new Set(
    episodes.map(
      (episode) =>
        `${episode.showId}|${Core.normalizeText(episode.episodeLabel).toLocaleLowerCase()}`
    )
  );
  const synthesized = [];

  for (const record of records) {
    const episodeKey = `${record.id}|${Core.normalizeText(
      record.episodeLabel
    ).toLocaleLowerCase()}`;
    if (!record.episodeLabel || existingEpisodes.has(episodeKey)) {
      continue;
    }
    const identity = Core.normalizeText(record.episodeLabel) || record.url;
    synthesized.push({
      completed: Boolean(record.episodeCompleted),
      duration: record.duration,
      episodeLabel: record.episodeLabel,
      firstSeenAt: record.updatedAt,
      id: episodeIdFor(record.id, identity),
      pageTitle: record.pageTitle,
      position: record.position,
      progress: record.progress,
      showId: record.id,
      storageKey: null,
      synthesized: true,
      updatedAt: record.updatedAt,
      url: record.url,
      version: SCHEMA_VERSION
    });
  }

  return [...episodes, ...synthesized].sort(
    (left, right) => Number(right.updatedAt) - Number(left.updatedAt)
  );
}

async function getLibraryState() {
  const syncState = await synchronizeStorage();
  const [records, storedEpisodes] = await Promise.all([
    getAllRecords(),
    getAllEpisodes()
  ]);
  const episodes = synthesizeCurrentEpisodes(records, storedEpisodes);
  const localState = await storageGet(chrome.storage.local, SYNC_ISSUE_KEY).catch(
    () => ({})
  );

  return {
    episodes,
    device: syncState.device,
    devices: syncState.devices,
    ok: true,
    shows: records,
    syncIssue: localState[SYNC_ISSUE_KEY] || null,
    syncState
  };
}

// This function is serialized into every frame by chrome.scripting.executeScript.
// Keep it self-contained: it cannot reference background.js variables.
function inspectFrameInMainWorld() {
  const normalize = (value) =>
    String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  const readText = (selectors) => {
    for (const selector of selectors) {
      let elements;
      try {
        elements = document.querySelectorAll(selector);
      } catch (_error) {
        continue;
      }
      for (const element of elements) {
        const text = normalize(element.textContent);
        const style = getComputedStyle(element);
        if (
          text &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        ) {
          return text;
        }
      }
    }
    return "";
  };

  const readMeta = (name) => {
    const element =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return normalize(element && element.content);
  };

  const videos = Array.from(document.querySelectorAll("video"));
  let bestVideo = null;
  let bestScore = -1;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden") {
      continue;
    }

    const duration = Number(video.duration);
    const score =
      (!video.paused && !video.ended ? 100000000 : 0) +
      Math.max(0, rect.width) * Math.max(0, rect.height) +
      (Number.isFinite(duration) ? Math.min(duration, 10000) : 0);
    if (score > bestScore) {
      bestScore = score;
      bestVideo = video;
    }
  }

  const episodeText = readText([
    "[aria-current=\"true\"]",
    "[class*=\"episode\"][class*=\"active\"]",
    "[class*=\"episode\"][class*=\"current\"]",
    "[class*=\"episode\"][class*=\"selected\"]",
    "[class*=\"active\"][class*=\"playlist-item\"]"
  ]);
  const titleText = readText([
    "[data-uia=\"video-title\"]",
    "[class*=\"video-title\"]",
    "[class*=\"player-title\"]",
    "[class*=\"media-title\"]",
    "h1"
  ]);

  const duration = bestVideo && Number(bestVideo.duration);
  const currentTime = bestVideo && Number(bestVideo.currentTime);

  return {
    activeEpisodeText: episodeText,
    currentTime: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
    duration:
      bestVideo && Number.isFinite(duration) && duration > 0 ? duration : 0,
    ended: Boolean(bestVideo && bestVideo.ended),
    frameTitle: normalize(document.title),
    hasVideo: Boolean(bestVideo),
    heading: titleText,
    mediaSessionTitle: normalize(
      navigator.mediaSession &&
        navigator.mediaSession.metadata &&
        (navigator.mediaSession.metadata.title ||
          navigator.mediaSession.metadata.artist)
    ),
    ogTitle: readMeta("og:title"),
    paused: bestVideo ? Boolean(bestVideo.paused) : true,
    readyState: bestVideo ? Number(bestVideo.readyState) || 0 : 0,
    score: Math.max(0, bestScore),
    url: location.href,
    videoWidth: bestVideo ? Math.round(bestVideo.clientWidth || 0) : 0,
    videoHeight: bestVideo ? Math.round(bestVideo.clientHeight || 0) : 0
  };
}

function scoreTitleCandidate(value, rawValue) {
  const normalized = Core.normalizeText(value);
  if (normalized.length < 2) {
    return -100;
  }

  let score = Math.min(normalized.length, 24) / 4;
  if (Core.extractEpisodeLabel(rawValue)) {
    score += 3;
  }
  if (/^(视频|播放|首页|动漫|在线观看|当前视频)$/i.test(normalized)) {
    score -= 20;
  }
  return score;
}

function buildSnapshot(tab, results) {
  const frameResults = results
    .map((injection) => injection && injection.result)
    .filter(Boolean);
  const videoResults = frameResults
    .filter((result) => result.hasVideo && Number(result.score) > 0)
    .sort((left, right) => Number(right.score) - Number(left.score));
  const bestVideo = videoResults[0] || null;
  const site = Core.getSite(tab.url || "");

  const rawTexts = [
    bestVideo && bestVideo.activeEpisodeText,
    tab.title,
    bestVideo && bestVideo.frameTitle,
    bestVideo && bestVideo.ogTitle,
    bestVideo && bestVideo.mediaSessionTitle,
    ...frameResults.map((result) => result.activeEpisodeText),
    ...frameResults.map((result) => result.frameTitle),
    ...frameResults.map((result) => result.ogTitle)
  ]
    .map((value) => Core.normalizeText(value))
    .filter(Boolean);

  const titleCandidates = [];
  const seenTitles = new Set();
  for (const rawValue of [
    tab.title,
    bestVideo && bestVideo.heading,
    bestVideo && bestVideo.mediaSessionTitle,
    bestVideo && bestVideo.ogTitle,
    bestVideo && bestVideo.frameTitle,
    ...frameResults.map((result) => result.heading),
    ...frameResults.map((result) => result.ogTitle)
  ]) {
    const raw = Core.normalizeText(rawValue);
    if (!raw) {
      continue;
    }
    const cleaned = Core.cleanSeriesTitle(raw);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seenTitles.has(key)) {
      continue;
    }
    seenTitles.add(key);
    titleCandidates.push({
      score: scoreTitleCandidate(cleaned, raw),
      value: cleaned
    });
  }

  titleCandidates.sort((left, right) => right.score - left.score);
  const title = titleCandidates[0]?.value || "当前视频";
  const episodeLabel =
    rawTexts.map((text) => Core.extractEpisodeLabel(text)).find(Boolean) || "";
  const duration = bestVideo ? Math.max(0, Number(bestVideo.duration) || 0) : 0;
  const currentTime = bestVideo
    ? Math.max(0, Number(bestVideo.currentTime) || 0)
    : 0;
  const pageTitle =
    Core.normalizeText(tab.title) ||
    Core.normalizeText(bestVideo && bestVideo.frameTitle);

  return {
    audible: Boolean(tab.audible),
    canTrack: Boolean(bestVideo && duration > 0),
    capturedAt: Date.now(),
    currentTime,
    duration,
    ended: Boolean(bestVideo && bestVideo.ended),
    episodeLabel,
    hasVideo: Boolean(bestVideo),
    pageTitle,
    paused: bestVideo ? Boolean(bestVideo.paused) : true,
    seriesKey: Core.deriveSeriesKey(tab.url || "", title),
    site: site.id,
    siteLabel: site.label,
    title,
    url: tab.url || ""
  };
}

async function exportBackup() {
  await synchronizeStorage();
  const [shows, episodes] = await Promise.all([
    getAllRecords(),
    getAllEpisodes()
  ]);
  return {
    backup: {
      episodes: episodes.map(({ storageKey: _storageKey, ...episode }) =>
        sanitizeEpisodeRecord(episode)
      ),
      exportedAt: Date.now(),
      shows,
      version: 1
    },
    ok: true
  };
}

async function importBackup(message) {
  const backup = message.backup;
  if (
    !backup ||
    !Array.isArray(backup.shows) ||
    !Array.isArray(backup.episodes)
  ) {
    throw new Error("备份文件格式无效");
  }

  const [syncAll, localAll] = await Promise.all([
    storageGet(chrome.storage.sync, null).catch(() => ({})),
    storageGet(chrome.storage.local, null).catch(() => ({}))
  ]);
  const syncValues = {};
  let showCount = 0;
  let episodeCount = 0;

  for (const source of backup.shows) {
    const record = sanitizeRecord(source);
    if (!record.id || !record.seriesKey) {
      continue;
    }
    const key = syncKeyFor(record.id);
    const existing = syncAll[key] || localAll[localKeyFor(record.id)];
    if (!existing || Number(record.updatedAt) >= Number(existing.updatedAt)) {
      syncValues[key] = record;
      showCount += 1;
    }
  }

  for (const source of backup.episodes) {
    const episode = sanitizeEpisodeRecord(source);
    if (!episode.id || !episode.showId) {
      continue;
    }
    const key = syncKeyForEpisode(episode.id);
    const existing =
      syncAll[key] || localAll[localKeyForEpisode(episode.id)];
    if (!existing || Number(episode.updatedAt) >= Number(existing.updatedAt)) {
      syncValues[key] = episode;
      episodeCount += 1;
    }
  }

  if (Object.keys(syncValues).length) {
    const localValues = {};
    for (const [key, value] of Object.entries(syncValues)) {
      if (key.startsWith(SYNC_SHOW_PREFIX)) {
        localValues[localKeyFor(key.slice(SYNC_SHOW_PREFIX.length))] = value;
      } else if (key.startsWith(EPISODE_SYNC_PREFIX)) {
        localValues[localKeyForEpisode(key.slice(EPISODE_SYNC_PREFIX.length))] =
          value;
      }
    }
    await storageSet(chrome.storage.local, localValues);
    try {
      await storageSet(chrome.storage.sync, syncValues);
      await setSyncIssue(null);
    } catch (error) {
      await setSyncIssue(error);
    }
  }

  return {
    episodes: episodeCount,
    ok: true,
    shows: showCount
  };
}

async function getTabSnapshot(tabId, options) {
  const settings = options || {};
  const cached = snapshotCache.get(tabId);
  if (!settings.fresh && cached && Date.now() - cached.cachedAt < SNAPSHOT_CACHE_MS) {
    return cached.snapshot;
  }

  const tab = await getTab(tabId).catch(() => null);
  if (!tab) {
    return {
      canTrack: false,
      capturedAt: Date.now(),
      error: "标签页已关闭",
      hasVideo: false
    };
  }

  if (!/^https?:\/\//i.test(tab.url || "")) {
    return {
      canTrack: false,
      capturedAt: Date.now(),
      error: "当前页面不支持视频检测",
      hasVideo: false,
      pageTitle: tab.title || "",
      site: "generic",
      siteLabel: "网页视频",
      title: tab.title || "当前页面",
      url: tab.url || ""
    };
  }

  try {
    const results = await executeScript({
      target: { allFrames: true, tabId },
      world: "MAIN",
      func: inspectFrameInMainWorld
    });
    const snapshot = buildSnapshot(tab, results);
    snapshotCache.set(tabId, { cachedAt: Date.now(), snapshot });
    return snapshot;
  } catch (error) {
    const snapshot = {
      canTrack: false,
      capturedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
      hasVideo: false,
      pageTitle: tab.title || "",
      site: Core.getSite(tab.url || "").id,
      siteLabel: Core.getSite(tab.url || "").label,
      title: Core.cleanSeriesTitle(tab.title || "当前视频"),
      url: tab.url || ""
    };
    snapshotCache.set(tabId, { cachedAt: Date.now(), snapshot });
    return snapshot;
  }
}

function createWatchPending(identity, now, paused) {
  return {
    identity,
    lastObservedAt: now,
    lastPaused: Boolean(paused),
    watchedMs: 0
  };
}

function advanceWatchPending(existing, identity, now, paused) {
  if (!existing || existing.identity !== identity) {
    return createWatchPending(identity, now, paused);
  }

  const elapsed = Math.max(
    0,
    Math.min(now - Number(existing.lastObservedAt || now), MAX_WATCH_SAMPLE_MS)
  );
  return {
    identity,
    lastObservedAt: now,
    lastPaused: Boolean(paused),
    watchedMs:
      Number(existing.watchedMs || 0) + (existing.lastPaused ? 0 : elapsed)
  };
}

function snapshotRegressesEpisode(record, snapshot) {
  const recordedEpisode = Core.parseEpisodeNumber(record.episodeLabel);
  const observedEpisode = Core.parseEpisodeNumber(snapshot.episodeLabel);
  return (
    recordedEpisode != null &&
    observedEpisode != null &&
    observedEpisode < recordedEpisode
  );
}

function snapshotIsSameEpisode(record, snapshot) {
  const recordedEpisode = Core.normalizeText(record.episodeLabel);
  const observedEpisode = Core.normalizeText(snapshot.episodeLabel);
  return !recordedEpisode || !observedEpisode || recordedEpisode === observedEpisode;
}

async function startTracking(message) {
  const tabId = Number(message.tabId);
  if (!tabId) {
    throw new Error("没有找到当前标签页");
  }

  const snapshot = await getTabSnapshot(tabId, { fresh: true });
  if (!snapshot || !snapshot.canTrack) {
    throw new Error(
      snapshot && snapshot.error
        ? `无法读取视频：${snapshot.error}`
        : "当前页面还没有可记录的播放进度"
    );
  }

  const seriesKey =
    limitText(snapshot.seriesKey, 240) ||
    Core.deriveSeriesKey(snapshot.url, snapshot.title);
  const showId = Core.createShowId(seriesKey);
  const existingRecord = await getRecord(showId);
  const candidateRecord = recordFromSnapshot(snapshot, {
    episodeLabel: message.episodeLabel,
    episodeSource: message.episodeSource,
    id: showId,
    name: message.name || snapshot.title
  });
  const sessions = await loadSessions();
  const now = Date.now();
  const session = {
    lastSyncAt: now,
    seriesKey,
    showId,
    startedAt: now
  };

  let record = candidateRecord;
  let writeResult = { episode: null, record: candidateRecord, synced: true };
  let guardPending = false;

  if (existingRecord && snapshotRegressesEpisode(existingRecord, snapshot)) {
    session.episodeRegression = createWatchPending(
      Core.normalizeText(snapshot.episodeLabel) || snapshot.url,
      now,
      snapshot.paused
    );
    record = existingRecord;
    guardPending = true;
  } else if (
    existingRecord &&
    snapshotIsSameEpisode(existingRecord, snapshot) &&
    snapshot.currentTime + POSITION_REGRESSION_TOLERANCE_SEC <
      existingRecord.position
  ) {
    session.positionRegression = createWatchPending(
      Core.normalizeText(snapshot.episodeLabel) ||
        Core.normalizeText(existingRecord.episodeLabel) ||
        snapshot.url,
      now,
      snapshot.paused
    );
    record = existingRecord;
    guardPending = true;
  } else {
    const device = await getLocalDeviceProfile();
    const episodeId = episodeIdFor(
      candidateRecord.id,
      Core.normalizeText(candidateRecord.episodeLabel) ||
        snapshot.url ||
        candidateRecord.url
    );
    const existingEpisode = await getEpisodeRecord(episodeId);
    const episodeRecord = episodeRecordFromSnapshot(
      candidateRecord,
      snapshot,
      existingEpisode,
      device
    );
    writeResult = await writeRecord(candidateRecord, episodeRecord);
  }

  sessions[tabId] = session;
  await saveSessions();
  setBadge(tabId, true);
  createTrackingAlarm();

  return {
    deferredSync: !guardPending && !writeResult.synced,
    guardPending,
    ok: true,
    record: writeResult.record,
    session
  };
}

async function updateTrackedTab(tabId, options) {
  const settings = options || {};
  const sessions = await loadSessions();
  const session = sessions[tabId];
  if (!session) {
    return { active: false };
  }

  const snapshot = await getTabSnapshot(tabId, { fresh: true });
  if (!snapshot || !snapshot.hasVideo || !snapshot.duration) {
    return { active: true, written: false };
  }

  const record = await getRecord(session.showId);
  if (!record) {
    delete sessions[tabId];
    await saveSessions();
    setBadge(tabId, false);
    return { active: false, reason: "record-missing" };
  }

  if (snapshot.seriesKey !== session.seriesKey) {
    delete sessions[tabId];
    await saveSessions();
    setBadge(tabId, false);
    return { active: false, reason: "series-changed" };
  }

  const now = Date.now();
  const observedEpisode =
    Core.normalizeText(snapshot.episodeLabel) || snapshot.url;
  let guardConfirmed = false;

  if (snapshotRegressesEpisode(record, snapshot)) {
    session.episodeRegression = advanceWatchPending(
      session.episodeRegression,
      observedEpisode,
      now,
      snapshot.paused
    );
    delete session.positionRegression;
    sessions[tabId] = session;
    await saveSessions();

    if (session.episodeRegression.watchedMs < REGRESSION_CONFIRM_MS) {
      return {
        active: true,
        guard: "episode-regression",
        written: false
      };
    }

    delete session.episodeRegression;
    guardConfirmed = true;
  } else {
    delete session.episodeRegression;
  }

  const sameEpisode = snapshotIsSameEpisode(record, snapshot);
  if (
    !guardConfirmed &&
    sameEpisode &&
    snapshot.currentTime + POSITION_REGRESSION_TOLERANCE_SEC < record.position
  ) {
    const identity =
      Core.normalizeText(snapshot.episodeLabel) ||
      Core.normalizeText(record.episodeLabel) ||
      snapshot.url;
    session.positionRegression = advanceWatchPending(
      session.positionRegression,
      identity,
      now,
      snapshot.paused
    );
    sessions[tabId] = session;
    await saveSessions();

    if (session.positionRegression.watchedMs < REGRESSION_CONFIRM_MS) {
      return {
        active: true,
        guard: "position-regression",
        written: false
      };
    }

    delete session.positionRegression;
    guardConfirmed = true;
  } else {
    delete session.positionRegression;
  }

  const updated = sanitizeRecord({
    ...record,
    duration: snapshot.duration || record.duration,
    episodeCompleted:
      Boolean(snapshot.ended) ||
      (snapshot.duration > 0 && snapshot.duration - snapshot.currentTime <= 1),
    episodeLabel:
      record.episodeSource === "auto" && snapshot.episodeLabel
        ? snapshot.episodeLabel
        : record.episodeLabel,
    pageTitle: snapshot.pageTitle || record.pageTitle,
    position: snapshot.currentTime,
    seriesKey: session.seriesKey,
    site: snapshot.site || record.site,
    siteLabel: snapshot.siteLabel || record.siteLabel,
    updatedAt: now,
    url: snapshot.url || record.url
  });

  if (
    !settings.force &&
    !guardConfirmed &&
    now - Number(session.lastSyncAt || 0) < SYNC_INTERVAL_MS
  ) {
    sessions[tabId] = session;
    await saveSessions();
    return { active: true, written: false };
  }

  const episodeId = episodeIdFor(
    updated.id,
    Core.normalizeText(updated.episodeLabel) ||
      snapshot.url ||
      updated.url
  );
  const existingEpisode = await getEpisodeRecord(episodeId);
  const device = await getLocalDeviceProfile();
  const episodeRecord = episodeRecordFromSnapshot(
    updated,
    snapshot,
    existingEpisode,
    device
  );
  const result = await writeRecord(updated, episodeRecord);
  session.lastSyncAt = now;
  sessions[tabId] = session;
  await saveSessions();

  return {
    active: true,
    deferredSync: !result.synced,
    written: true
  };
}

async function stopTracking(tabId) {
  await updateTrackedTab(tabId, { force: true }).catch(() => {});
  const sessions = await loadSessions();
  const hadSession = Boolean(sessions[tabId]);
  delete sessions[tabId];
  await saveSessions();
  setBadge(tabId, false);
  return { ok: true, stopped: hadSession };
}

async function updateShow(message) {
  const record = await getRecord(message.id);
  if (!record) {
    throw new Error("追踪记录不存在");
  }

  const episodeSource = message.episodeSource === "manual" ? "manual" : "auto";
  const updated = sanitizeRecord({
    ...record,
    episodeLabel:
      episodeSource === "auto" && message.episodeLabel
        ? message.episodeLabel
        : message.episodeLabel || record.episodeLabel,
    episodeSource,
    name: message.name || record.name,
    updatedAt: Date.now()
  });
  const result = await writeRecord(updated);
  return { deferredSync: !result.synced, ok: true, record: result.record };
}

async function deleteShow(message) {
  const showId = limitText(message.id, 80);
  if (!showId) {
    return { ok: false };
  }

  const [syncAll, localAll] = await Promise.all([
    storageGet(chrome.storage.sync, null).catch(() => ({})),
    storageGet(chrome.storage.local, null).catch(() => ({}))
  ]);
  const syncKeys = Object.keys(syncAll).filter(
    (key) =>
      key === syncKeyFor(showId) ||
      key.startsWith(`${EPISODE_SYNC_PREFIX}${showId}.`)
  );
  const localKeys = Object.keys(localAll).filter(
    (key) =>
      key === localKeyFor(showId) ||
      key.startsWith(`${EPISODE_LOCAL_PREFIX}${showId}.`)
  );
  if (syncKeys.length) {
    await storageRemove(chrome.storage.sync, syncKeys).catch(() => {});
  }
  if (localKeys.length) {
    await storageRemove(chrome.storage.local, localKeys).catch(() => {});
  }

  const sessions = await loadSessions();
  for (const [tabId, session] of Object.entries(sessions)) {
    if (session.showId === showId) {
      delete sessions[tabId];
      setBadge(Number(tabId), false);
    }
  }
  await saveSessions();
  return { ok: true };
}

async function deleteEpisode(message) {
  const storageKey = String(message.storageKey || "");
  const episodeId = limitText(
    message.episodeId ||
      (storageKey.startsWith(EPISODE_SYNC_PREFIX)
        ? storageKey.slice(EPISODE_SYNC_PREFIX.length)
        : storageKey.startsWith(EPISODE_LOCAL_PREFIX)
          ? storageKey.slice(EPISODE_LOCAL_PREFIX.length)
          : ""),
    180
  );
  if (!episodeId) {
    return { ok: false, error: "无效的剧集记录" };
  }

  const [episodes, sessions] = await Promise.all([
    getAllEpisodes(),
    loadSessions()
  ]);
  const target =
    episodes.find((episode) => episode.id === episodeId) ||
    episodes.find(
      (episode) =>
        storageKey && episode.storageKey === storageKey
    ) ||
    null;
  const showId = limitText(target?.showId || message.showId, 80);
  const episodeLabel = Core.normalizeText(
    target?.episodeLabel || message.episodeLabel
  );

  for (const [tabId, session] of Object.entries(sessions)) {
    if (session.showId === showId) {
      delete sessions[tabId];
      setBadge(Number(tabId), false);
    }
  }
  await saveSessions();

  await storageRemove(chrome.storage.sync, syncKeyForEpisode(episodeId)).catch(
    () => {}
  );
  await storageRemove(
    chrome.storage.local,
    localKeyForEpisode(episodeId)
  ).catch(() => {});

  const show = showId ? await getRecord(showId) : null;
  const currentLabel = Core.normalizeText(show && show.episodeLabel);
  if (
    show &&
    episodeLabel &&
    currentLabel &&
    currentLabel.toLocaleLowerCase() === episodeLabel.toLocaleLowerCase()
  ) {
    const remaining = (await getAllEpisodes())
      .filter((episode) => episode.showId === showId)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    if (remaining.length) {
      const next = remaining[0];
      await writeRecord(
        sanitizeRecord({
          ...show,
          duration: next.duration,
          episodeCompleted: next.completed,
          episodeLabel: next.episodeLabel,
          pageTitle: next.pageTitle,
          position: next.position,
          updatedAt: next.updatedAt,
          url: next.url
        })
      );
    } else {
      await deleteShow({ id: showId });
      return { ok: true, showDeleted: true };
    }
  }

  return { ok: true, showDeleted: false };
}

async function getAppState(message) {
  const syncState = await synchronizeStorage();
  const [records, sessionsResult] = await Promise.all([
    getAllRecords(),
    loadSessions()
  ]);
  const tabId = Number(message.tabId);
  const localState = await storageGet(chrome.storage.local, SYNC_ISSUE_KEY).catch(
    () => ({})
  );

  return {
    ok: true,
    device: syncState.device,
    devices: syncState.devices,
    records,
    session: tabId ? sessionsResult[tabId] || null : null,
    syncIssue: localState[SYNC_ISSUE_KEY] || null,
    syncState
  };
}

function createTrackingAlarm() {
  if (chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create(TRACKING_ALARM, {
      periodInMinutes: ALARM_PERIOD_MINUTES
    });
  }
}

async function heartbeat() {
  await synchronizeStorage().catch(() => {});
  const sessions = await loadSessions();
  const trackedTabs = Object.keys(sessions).map(Number).filter(Boolean);
  if (!trackedTabs.length) {
    return;
  }

  const tabs = await queryTabs({}).catch(() => []);
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  for (const tabId of trackedTabs) {
    const tab = tabsById.get(tabId);
    if (!tab || (!tab.active && !tab.audible)) {
      continue;
    }
    await updateTrackedTab(tabId, { force: false }).catch(() => {});
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case "VT_GET_APP_STATE":
      return getAppState(message);
    case "VT_GET_LIBRARY_STATE":
      return getLibraryState();
    case "VT_EXPORT_BACKUP":
      return exportBackup();
    case "VT_IMPORT_BACKUP":
      return importBackup(message);
    case "VT_SYNC_NOW":
      return synchronizeStorage({ forceDeviceHeartbeat: true });
    case "VT_GET_DEVICE_LIST": {
      const state = await synchronizeStorage();
      return {
        device: state.device,
        devices: state.devices,
        ok: true
      };
    }
    case "VT_RENAME_DEVICE":
      return renameDevice(message);
    case "VT_TOUCH_DEVICE":
      return touchDeviceHeartbeat({ force: true });
    case "VT_GET_SNAPSHOT":
      return getTabSnapshot(Number(message.tabId), { fresh: true });
    case "VT_START_TRACKING":
      return startTracking(message);
    case "VT_STOP_TRACKING":
      return stopTracking(Number(message.tabId));
    case "VT_SYNC_TAB":
      return updateTrackedTab(Number(message.tabId), { force: true });
    case "VT_UPDATE_SHOW":
      return updateShow(message);
    case "VT_DELETE_SHOW":
      return deleteShow(message);
    case "VT_DELETE_EPISODE":
      return deleteEpisode(message);
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
        ok: false
      });
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const relevant =
    changeInfo.url ||
    changeInfo.title ||
    changeInfo.status === "complete" ||
    typeof changeInfo.audible === "boolean";
  if (!relevant) {
    return;
  }

  snapshotCache.delete(tabId);
  loadSessions()
    .then((sessions) => {
      if (sessions[tabId]) {
        return updateTrackedTab(tabId, { force: true });
      }
      return null;
    })
    .catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  snapshotCache.delete(tabId);
  loadSessions()
    .then((sessions) => {
      if (sessions[tabId]) {
        return updateTrackedTab(tabId, { force: true });
      }
      return null;
    })
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  snapshotCache.delete(tabId);
  const sessions = await loadSessions();
  if (!sessions[tabId]) {
    return;
  }
  delete sessions[tabId];
  await saveSessions();
});

chrome.windows.onFocusChanged.addListener(() => {
  heartbeat().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TRACKING_ALARM) {
    heartbeat().catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await storageSet(chrome.storage.local, {
    [LOCAL_SCHEMA_KEY]: SCHEMA_VERSION
  }).catch(() => {});
  createTrackingAlarm();
  await heartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  createTrackingAlarm();
  heartbeat().catch(() => {});
});
