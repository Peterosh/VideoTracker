importScripts("core.js", "i18n.js", "episode-discovery.js");

const Core = self.VideoTrackerCore;
const EpisodeDiscovery = self.VideoTrackerEpisodeDiscovery;
const I18n = self.VideoTrackerI18n;
const ACTIVE_SESSIONS_KEY = "vt.activeSessions.v1";
const DEVICE_PROFILE_KEY = "vt.deviceProfile.v1";
const DEVICE_SYNC_PREFIX = "vt.device.";
const EPISODE_LOCAL_PREFIX = "vt.local.episode.";
const EPISODE_SYNC_PREFIX = "vt.episode.";
const LATEST_EPISODE_LOCAL_PREFIX = "vt.local.latest.";
const LATEST_EPISODE_SYNC_PREFIX = "vt.latest.";
const LOCAL_SCHEMA_KEY = "vt.schemaVersion";
const LOCAL_SHOW_PREFIX = "vt.local.show.";
const SYNC_ISSUE_KEY = "vt.syncIssue";
const SYNC_SHOW_PREFIX = "vt.show.";
const TRACKING_SUPPRESSION_KEY = "vt.trackingSuppressions.v1";
const TRACKING_ALARM = "vt.trackingHeartbeat";
const LATEST_EPISODE_ALARM = "vt.latestEpisodeCheck";
const SCHEMA_VERSION = 3;
const SYNC_INTERVAL_MS = 15000;
const SNAPSHOT_CACHE_MS = 700;
const ALARM_PERIOD_MINUTES = 0.5;
const LATEST_EPISODE_ALARM_PERIOD_MINUTES = 60;
const LATEST_EPISODE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LATEST_EPISODE_FETCH_TIMEOUT_MS = 12000;
const REGRESSION_CONFIRM_MS = 60000;
const MAX_WATCH_SAMPLE_MS = 45000;
const POSITION_REGRESSION_TOLERANCE_SEC = 15;
const DEVICE_HEARTBEAT_INTERVAL_MS = 60000;
const AD_DURATION_MAX_SEC = 180;
const CONTENT_DURATION_MIN_SEC = 300;
const AD_DURATION_DROP_RATIO = 0.35;
const AD_STABILITY_MS = 6000;
const COMPLETION_PROGRESS_RATIO = 0.8;
const COMPLETION_MIN_WATCH_SECONDS = 300;
const RESUME_REWIND_SECONDS = 3;
const RESUME_NEAR_END_MIN_SECONDS = 15;
const RESUME_NEAR_END_MAX_SECONDS = 30;
const RESUME_SEEK_RETRY_MS = 500;
const RESUME_SEEK_MAX_ATTEMPTS = 120;
const RESUME_SEEK_STABLE_SAMPLES = 8;
const RESUME_TAB_LOAD_TIMEOUT_MS = 12000;

let sessionsCache = null;
let sessionsLoading = null;
let latestEpisodeCheckPromise = null;
let latestUpdateBadgeText = "";
const resumeChecks = new Map();
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

function createTab(properties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(properties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab || null);
    });
  });
}

function updateTab(tabId, properties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, properties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab || null);
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve) => {
    if (
      !windowId ||
      !chrome.windows ||
      typeof chrome.windows.update !== "function"
    ) {
      resolve(null);
      return;
    }
    chrome.windows.update(windowId, { focused: true }, (window) => {
      resolve(chrome.runtime.lastError ? null : window || null);
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    const hasUpdates = latestUpdateBadgeText === "NEW";
    chrome.action.setBadgeBackgroundColor({
      color: hasUpdates ? "#ff6b57" : "#f4b860",
      tabId
    });
    chrome.action.setBadgeText({
      tabId,
      text: hasUpdates ? "NEW" : active ? "ON" : ""
    });
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

async function getTrackingSuppressions() {
  const result = await storageGet(
    chrome.storage.local,
    TRACKING_SUPPRESSION_KEY
  ).catch(() => ({}));
  return result[TRACKING_SUPPRESSION_KEY] || {};
}

async function setTrackingSuppressed(tabId, seriesKey) {
  if (!tabId || !seriesKey) {
    return;
  }
  const suppressions = await getTrackingSuppressions();
  suppressions[tabId] = {
    seriesKey,
    updatedAt: Date.now()
  };
  await storageSet(chrome.storage.local, {
    [TRACKING_SUPPRESSION_KEY]: suppressions
  });
}

async function clearTrackingSuppression(tabId) {
  if (!tabId) {
    return;
  }
  const suppressions = await getTrackingSuppressions();
  if (!(tabId in suppressions)) {
    return;
  }
  delete suppressions[tabId];
  await storageSet(chrome.storage.local, {
    [TRACKING_SUPPRESSION_KEY]: suppressions
  });
}

async function maybeResumeTrackedTab(tabId) {
  const numericTabId = Number(tabId);
  if (!numericTabId) {
    return null;
  }
  if (resumeChecks.has(numericTabId)) {
    return resumeChecks.get(numericTabId);
  }

  const check = (async () => {
    const sessions = await loadSessions();
    if (sessions[numericTabId]) {
      return sessions[numericTabId];
    }

    const tab = await getTab(numericTabId).catch(() => null);
    if (!tab || (!tab.active && !tab.audible)) {
      return null;
    }

    const snapshot = await getTabSnapshot(numericTabId, { fresh: true });
    if (
      !snapshot ||
      !snapshot.hasVideo ||
      !snapshot.duration ||
      !snapshot.seriesKey
    ) {
      return null;
    }

    const suppressions = await getTrackingSuppressions();
    const suppression = suppressions[numericTabId];
    if (suppression && suppression.seriesKey === snapshot.seriesKey) {
      return null;
    }
    if (suppression) {
      await clearTrackingSuppression(numericTabId);
    }

    const showId = Core.createShowId(snapshot.seriesKey);
    const record = await getRecord(showId);
    if (!record) {
      return null;
    }

    const now = Date.now();
    const session = {
      adObservationKey: "",
      adObservationSince: 0,
      autoResumed: true,
      contentDuration: Number(record.duration) || 0,
      contentSourceKey: "",
      lastObservedAt: now,
      lastObservedPosition: Number(snapshot.currentTime) || 0,
      lastSyncAt: now,
      seriesKey: snapshot.seriesKey,
      showId,
      startedAt: now,
      watchedSeconds: 0
    };
    sessions[numericTabId] = session;
    await saveSessions();
    setBadge(numericTabId, true);
    createTrackingAlarm();
    return session;
  })();

  resumeChecks.set(numericTabId, check);
  try {
    return await check;
  } finally {
    resumeChecks.delete(numericTabId);
  }
}

async function resumeActiveTrackedTabs() {
  const tabs = await queryTabs({ active: true }).catch(() => []);
  for (const tab of tabs) {
    if (tab && tab.id) {
      await maybeResumeTrackedTab(tab.id).catch(() => {});
    }
  }
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

function latestSyncKeyFor(showId) {
  return `${LATEST_EPISODE_SYNC_PREFIX}${showId}`;
}

function latestLocalKeyFor(showId) {
  return `${LATEST_EPISODE_LOCAL_PREFIX}${showId}`;
}

function limitText(value, maximum) {
  return Core.normalizeText(value).slice(0, maximum);
}

function sanitizeRecord(record) {
  const episodeLabel = limitText(record.episodeLabel, 40);
  const currentEpisodeNumber =
    Core.parseEpisodeNumber(episodeLabel) || 0;
  const storedMaxEpisodeNumber = Math.max(
    0,
    Math.floor(Number(record.maxWatchedEpisodeNumber) || 0)
  );
  const maxWatchedEpisodeNumber = Math.max(
    currentEpisodeNumber,
    storedMaxEpisodeNumber
  );
  const storedMaxEpisodeLabel = limitText(
    record.maxWatchedEpisodeLabel,
    40
  );
  const maxWatchedEpisodeLabel =
    maxWatchedEpisodeNumber > 0
      ? Core.parseEpisodeNumber(storedMaxEpisodeLabel) ===
        maxWatchedEpisodeNumber
        ? storedMaxEpisodeLabel
        : Core.episodeLabelFromNumber(maxWatchedEpisodeNumber)
      : "";

  return {
    duration: Math.max(0, Number(record.duration) || 0),
    episodeCompleted: Boolean(record.episodeCompleted),
    episodeLabel,
    episodeSource: record.episodeSource === "manual" ? "manual" : "auto",
    id: limitText(record.id, 80),
    maxWatchedEpisodeLabel,
    maxWatchedEpisodeNumber,
    name: limitText(record.name, 100) || I18n.t("未命名剧集"),
    pageTitle: limitText(record.pageTitle, 300),
    pinned: Boolean(record.pinned),
    pinnedAt: record.pinned
      ? Math.max(0, Number(record.pinnedAt) || 0)
      : 0,
    position: Math.max(0, Number(record.position) || 0),
    progress: Core.calculateProgress(record.position, record.duration),
    seriesKey: limitText(record.seriesKey, 240),
    site: limitText(record.site, 40) || "generic",
    siteLabel: limitText(record.siteLabel, 40) || I18n.t("网页视频"),
    updatedAt: Number(record.updatedAt) || Date.now(),
    url: String(record.url || "").slice(0, 1800),
    version: SCHEMA_VERSION
  };
}

function sanitizeLatestEpisodeState(record) {
  const episodeNumber = Math.max(
    0,
    Math.floor(Number(record.episodeNumber) || 0)
  );
  const episodeLabel = limitText(record.episodeLabel, 40);

  return {
    checkedAt: Math.max(0, Number(record.checkedAt) || 0),
    detectedAt: Math.max(0, Number(record.detectedAt) || 0),
    episodeLabel:
      episodeNumber > 0
        ? Core.parseEpisodeNumber(episodeLabel) === episodeNumber
          ? episodeLabel
          : Core.episodeLabelFromNumber(episodeNumber)
        : "",
    episodeNumber,
    error: limitText(record.error, 200),
    id: limitText(record.id || record.showId, 80),
    showId: limitText(record.showId || record.id, 80),
    source: limitText(record.source, 40),
    status: record.status === "error" ? "error" : "ok",
    updatedAt: Number(record.updatedAt) || Date.now(),
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
    name: I18n.t("未命名设备"),
    nameUpdatedAt: 0,
    networkUpdatedAt: 0,
    platform: I18n.t("未知平台"),
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
        name: value.name || I18n.t("未命名设备"),
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
    name: profile.name || I18n.t("未命名设备"),
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
      name: limitText(profile.name, 80) || I18n.t("未命名设备"),
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
    throw new Error(I18n.t("设备名称无效"));
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
    throw new Error(I18n.t("设备记录不存在"));
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

function episodeRecordFromSnapshot(
  record,
  snapshot,
  existing,
  device,
  completed
) {
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
      Boolean(existing && existing.completed) ||
      Boolean(completed) ||
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

async function writeLatestEpisodeState(state) {
  const normalized = sanitizeLatestEpisodeState(state);
  if (!normalized.showId) {
    throw new Error(I18n.t("追踪记录不存在"));
  }

  await storageSet(chrome.storage.local, {
    [latestLocalKeyFor(normalized.showId)]: normalized
  });
  try {
    await storageSet(chrome.storage.sync, {
      [latestSyncKeyFor(normalized.showId)]: normalized
    });
    return { state: normalized, synced: true };
  } catch (error) {
    await setSyncIssue(error);
    return { state: normalized, synced: false };
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

function collectLatestEpisodeStates(stored, prefix) {
  const states = [];
  for (const [key, value] of Object.entries(stored || {})) {
    if (key.startsWith(prefix) && value && value.showId) {
      states.push({
        ...sanitizeLatestEpisodeState(value),
        storageKey: key
      });
    }
  }
  return states;
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

  for (const state of collectLatestEpisodeStates(
    localData,
    LATEST_EPISODE_LOCAL_PREFIX
  )) {
    const normalized = sanitizeLatestEpisodeState(state);
    const key = latestSyncKeyFor(normalized.showId);
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

  for (const state of collectLatestEpisodeStates(
    syncData,
    LATEST_EPISODE_SYNC_PREFIX
  )) {
    const normalized = sanitizeLatestEpisodeState(state);
    const key = latestLocalKeyFor(normalized.showId);
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

  return Array.from(recordsById.values()).sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    if (left.pinned) {
      const pinnedOrder =
        Number(right.pinnedAt) - Number(left.pinnedAt);
      if (pinnedOrder !== 0) {
        return pinnedOrder;
      }
    }
    return Number(right.updatedAt) - Number(left.updatedAt);
  });
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

async function getAllLatestEpisodeStates() {
  const [syncResult, localResult] = await Promise.all([
    storageGet(chrome.storage.sync, null).catch(() => ({})),
    storageGet(chrome.storage.local, null).catch(() => ({}))
  ]);

  const statesByShowId = new Map();
  for (const state of [
    ...collectLatestEpisodeStates(syncResult, LATEST_EPISODE_SYNC_PREFIX),
    ...collectLatestEpisodeStates(localResult, LATEST_EPISODE_LOCAL_PREFIX)
  ]) {
    const current = statesByShowId.get(state.showId);
    if (!current || Number(state.updatedAt) > Number(current.updatedAt)) {
      statesByShowId.set(state.showId, state);
    }
  }

  return Array.from(statesByShowId.values());
}

async function reconcileMaxWatchedEpisodes(records, episodes) {
  const maxByShowId = new Map();
  for (const episode of episodes) {
    const number = Core.parseEpisodeNumber(episode.episodeLabel);
    if (number != null) {
      maxByShowId.set(
        episode.showId,
        Math.max(number, maxByShowId.get(episode.showId) || 0)
      );
    }
  }

  return Promise.all(
    records.map(async (record) => {
      const maxFromHistory = maxByShowId.get(record.id) || 0;
      if (maxFromHistory <= Number(record.maxWatchedEpisodeNumber || 0)) {
        return record;
      }

      const result = await writeRecord(
        sanitizeRecord({
          ...record,
          maxWatchedEpisodeLabel:
            Core.episodeLabelFromNumber(maxFromHistory),
          maxWatchedEpisodeNumber: maxFromHistory
        })
      );
      return result.record;
    })
  );
}

function presentRecordWithLatest(record, latestState) {
  const latest = latestState
    ? sanitizeLatestEpisodeState(latestState)
    : null;
  return {
    ...record,
    hasNewEpisode: Boolean(
      latest &&
        latest.episodeNumber >
          Number(record.maxWatchedEpisodeNumber || 0)
    ),
    latestCheckError: latest?.error || "",
    latestCheckedAt: Number(latest?.checkedAt) || 0,
    latestEpisodeDetectedAt: Number(latest?.detectedAt) || 0,
    latestEpisodeLabel: latest?.episodeLabel || "",
    latestEpisodeNumber: Number(latest?.episodeNumber) || 0,
    latestEpisodeSource: latest?.source || "",
    latestEpisodeStatus: latest?.status || "unknown"
  };
}

function presentRecordsWithLatest(records, latestStates) {
  const latestByShowId = new Map(
    latestStates.map((state) => [state.showId, state])
  );
  return records.map((record) =>
    presentRecordWithLatest(record, latestByShowId.get(record.id))
  );
}

async function updateLatestUpdateBadge() {
  const [rawRecords, episodes, latestStates, sessions] = await Promise.all([
    getAllRecords(),
    getAllEpisodes(),
    getAllLatestEpisodeStates(),
    loadSessions().catch(() => ({}))
  ]);
  const records = await reconcileMaxWatchedEpisodes(rawRecords, episodes);
  const hasUpdates = presentRecordsWithLatest(
    records,
    latestStates
  ).some((record) => record.hasNewEpisode);
  const text = hasUpdates ? "NEW" : "";
  if (text === latestUpdateBadgeText) {
    return hasUpdates;
  }

  latestUpdateBadgeText = text;
  try {
    const color = hasUpdates ? "#ff6b57" : "#f4b860";
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    for (const tabId of Object.keys(sessions).map(Number).filter(Boolean)) {
      chrome.action.setBadgeBackgroundColor({ color, tabId });
      chrome.action.setBadgeText({
        tabId,
        text: hasUpdates ? "NEW" : "ON"
      });
    }
  } catch (_error) {
    // Badge updates must not interrupt tracking or synchronization.
  }
  return hasUpdates;
}

async function fetchLatestEpisodeFromPage(record) {
  if (typeof fetch !== "function") {
    throw new Error(I18n.t("当前环境无法检查网站更新"));
  }
  if (!/^https?:\/\//i.test(record.url || "")) {
    throw new Error(I18n.t("没有可检查的观看页面"));
  }

  const controller =
    typeof AbortController === "function"
      ? new AbortController()
      : null;
  const timer = setTimeout(() => {
    controller?.abort();
  }, LATEST_EPISODE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(record.url, {
      cache: "no-store",
      credentials: "include",
      redirect: "follow",
      signal: controller?.signal
    });
    if (!response || !response.ok) {
      throw new Error(
        I18n.t("网站返回错误 {status}", {
          status: Number(response && response.status) || 0
        })
      );
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function checkLatestEpisodes(options) {
  const settings = options || {};
  if (latestEpisodeCheckPromise) {
    return latestEpisodeCheckPromise;
  }

  const check = (async () => {
    const now = Date.now();
    const [rawRecords, storedEpisodes, initialStates] = await Promise.all([
      getAllRecords(),
      getAllEpisodes(),
      getAllLatestEpisodeStates()
    ]);
    const records = await reconcileMaxWatchedEpisodes(
      rawRecords,
      storedEpisodes
    );
    const statesByShowId = new Map(
      initialStates.map((state) => [state.showId, state])
    );
    const candidates = records.filter((record) => {
      if (!/^https?:\/\//i.test(record.url || "")) {
        return false;
      }
      if (settings.force) {
        return true;
      }
      const state = statesByShowId.get(record.id);
      return (
        !state ||
        now - Number(state.checkedAt || 0) >=
          LATEST_EPISODE_CHECK_INTERVAL_MS
      );
    });

    let checked = 0;
    let failed = 0;
    let updated = 0;
    let deferredSync = 0;

    for (const record of candidates) {
      checked += 1;
      let discovery = null;
      let error = null;
      try {
        const html = await fetchLatestEpisodeFromPage(record);
        if (!EpisodeDiscovery || !EpisodeDiscovery.extractLatestEpisode) {
          throw new Error(I18n.t("当前环境无法检查网站更新"));
        }
        discovery = EpisodeDiscovery.extractLatestEpisode(html, {
          currentUrl: record.url,
          seriesName: record.name
        });
        if (!discovery) {
          throw new Error(I18n.t("未找到分集信息"));
        }
      } catch (fetchError) {
        error =
          fetchError instanceof Error
            ? fetchError.message
            : String(fetchError);
      }

      const currentRecord = await getRecord(record.id);
      if (!currentRecord) {
        continue;
      }

      const currentStates = await getAllLatestEpisodeStates();
      const currentState =
        currentStates.find((state) => state.showId === record.id) || null;
      const previousNumber = Number(currentState?.episodeNumber) || 0;
      const nextNumber = discovery
        ? Math.max(previousNumber, discovery.number)
        : previousNumber;
      const hasNewNumber = Boolean(
        discovery && discovery.number > previousNumber
      );
      if (hasNewNumber) {
        updated += 1;
      }
      if (error) {
        failed += 1;
      }

      const result = await writeLatestEpisodeState({
        checkedAt: Date.now(),
        detectedAt: hasNewNumber
          ? Date.now()
          : currentState?.detectedAt || 0,
        episodeLabel:
          nextNumber > 0
            ? Core.episodeLabelFromNumber(nextNumber)
            : "",
        episodeNumber: nextNumber,
        error: error || "",
        id: record.id,
        showId: record.id,
        source: discovery?.source || currentState?.source || "",
        status: error ? "error" : "ok",
        updatedAt: Date.now()
      });
      if (!result.synced) {
        deferredSync += 1;
      }
    }

    await updateLatestUpdateBadge().catch(() => {});
    return {
      checked,
      deferredSync,
      failed,
      ok: true,
      updated
    };
  })();

  latestEpisodeCheckPromise = check.finally(() => {
    latestEpisodeCheckPromise = null;
  });
  return latestEpisodeCheckPromise;
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
  const [rawRecords, storedEpisodes, latestStates] = await Promise.all([
    getAllRecords(),
    getAllEpisodes(),
    getAllLatestEpisodeStates()
  ]);
  const records = await reconcileMaxWatchedEpisodes(
    rawRecords,
    storedEpisodes
  );
  const episodes = synthesizeCurrentEpisodes(records, storedEpisodes);
  const shows = presentRecordsWithLatest(records, latestStates);
  const localState = await storageGet(chrome.storage.local, SYNC_ISSUE_KEY).catch(
    () => ({})
  );
  await updateLatestUpdateBadge().catch(() => {});

  return {
    episodes,
    device: syncState.device,
    devices: syncState.devices,
    ok: true,
    shows,
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

  const isVisibleElement = (element) => {
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };

  const adMarkerPattern =
    /(^|[\s_-])(ad|ads|advert|advertisement|adplayer|ad-player|preroll|pre-roll|midroll|mid-roll|txp[_-]?ad)(?=$|[\s_-])/i;
  const adTextPattern =
    /^(?:广告(?:倒计时)?|跳过广告|关闭广告|广告\s*\d+\s*秒?|advertisement|ad\s*\d*)$/i;

  const adMarkerText = (element) =>
    normalize(
      [
        element.id,
        typeof element.className === "string" ? element.className : "",
        element.getAttribute("aria-label"),
        element.getAttribute("data-role"),
        element.getAttribute("data-testid")
      ]
        .filter(Boolean)
        .join(" ")
    );

  const detectAdEvidence = (video) => {
    const source = String(video.currentSrc || video.src || "");
    const sourcePath = source.split(/[?#]/, 1)[0];
    if (adMarkerPattern.test(sourcePath)) {
      return { detected: true, reason: "source" };
    }

    const videoRoot =
      typeof video.getRootNode === "function" ? video.getRootNode() : null;
    let container =
      video.parentElement || (videoRoot && videoRoot.host ? videoRoot.host : null);
    for (let depth = 0; depth < 12 && container; depth += 1) {
      if (container === document.body || container === document.documentElement) {
        break;
      }
      if (adMarkerPattern.test(adMarkerText(container))) {
        return { detected: true, reason: "container" };
      }

      const candidates = container.querySelectorAll(
        [
          "[class*='advert']",
          "[class*='ad-countdown']",
          "[class*='skip-ad']",
          "[class*='txp_ad']",
          "[class*='txp-ad']",
          "[data-testid*='ad']",
          "[aria-label*='广告']",
          "[aria-label*='advertisement' i]"
        ].join(",")
      );
      for (const candidate of candidates) {
        if (
          isVisibleElement(candidate) &&
          (adTextPattern.test(normalize(candidate.textContent)) ||
            adMarkerPattern.test(adMarkerText(candidate)))
        ) {
          return { detected: true, reason: "overlay" };
        }
      }
      const rootNode =
        typeof container.getRootNode === "function"
          ? container.getRootNode()
          : null;
      container =
        container.parentElement ||
        (rootNode && rootNode.host ? rootNode.host : null);
    }

    return { detected: false, reason: "" };
  };

  const videos = [];
  const visitedRoots = new Set();
  const visitedVideos = new Set();
  const collectVideos = (root) => {
    if (!root || visitedRoots.has(root)) {
      return;
    }
    visitedRoots.add(root);

    for (const video of root.querySelectorAll("video")) {
      if (!visitedVideos.has(video)) {
        visitedVideos.add(video);
        videos.push(video);
      }
    }
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        collectVideos(element.shadowRoot);
      }
    }
  };
  collectVideos(document);
  let bestVideo = null;
  let bestScore = -1;
  let bestAdEvidence = { detected: false, reason: "" };
  let bestSource = "";

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden") {
      continue;
    }

    const duration = Number(video.duration);
    const adEvidence = detectAdEvidence(video);
    const score =
      (!video.paused && !video.ended ? 1e12 : 0) +
      (!adEvidence.detected ? 1e10 : 0) +
      Math.max(0, rect.width) * Math.max(0, rect.height) +
      (Number.isFinite(duration) ? Math.min(duration, 10000) : 0);
    if (score > bestScore) {
      bestScore = score;
      bestVideo = video;
      bestAdEvidence = adEvidence;
      bestSource = String(video.currentSrc || video.src || "");
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
    adDetected: bestAdEvidence.detected,
    adReason: bestAdEvidence.reason,
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
    videoSource: bestSource,
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
  const title = titleCandidates[0]?.value || I18n.t("当前视频");
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
    adDetected: Boolean(bestVideo && bestVideo.adDetected),
    adReason: limitText(bestVideo && bestVideo.adReason, 40),
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
    url: tab.url || "",
    videoSource: limitText(bestVideo && bestVideo.videoSource, 1800)
  };
}

async function exportBackup() {
  await synchronizeStorage();
  const [shows, episodes, latestStates] = await Promise.all([
    getAllRecords(),
    getAllEpisodes(),
    getAllLatestEpisodeStates()
  ]);
  return {
    backup: {
      episodes: episodes.map(({ storageKey: _storageKey, ...episode }) =>
        sanitizeEpisodeRecord(episode)
      ),
      exportedAt: Date.now(),
      latestStates: latestStates.map(
        ({ storageKey: _storageKey, ...state }) =>
          sanitizeLatestEpisodeState(state)
      ),
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
    throw new Error(I18n.t("备份文件格式无效"));
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

  if (Array.isArray(backup.latestStates)) {
    for (const source of backup.latestStates) {
      const state = sanitizeLatestEpisodeState(source);
      if (!state.showId) {
        continue;
      }
      const key = latestSyncKeyFor(state.showId);
      const existing = syncAll[key] || localAll[latestLocalKeyFor(state.showId)];
      if (!existing || Number(state.updatedAt) >= Number(existing.updatedAt)) {
        syncValues[key] = state;
      }
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
      } else if (key.startsWith(LATEST_EPISODE_SYNC_PREFIX)) {
        localValues[
          latestLocalKeyFor(key.slice(LATEST_EPISODE_SYNC_PREFIX.length))
        ] = value;
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

  await updateLatestUpdateBadge().catch(() => {});
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
      error: I18n.t("标签页已关闭"),
      hasVideo: false
    };
  }

  if (!/^https?:\/\//i.test(tab.url || "")) {
    return {
      canTrack: false,
      capturedAt: Date.now(),
      error: I18n.t("当前页面不支持视频检测"),
      hasVideo: false,
      pageTitle: tab.title || "",
      site: "generic",
      siteLabel: I18n.t("网页视频"),
      title: tab.title || I18n.t("当前页面"),
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
      title: Core.cleanSeriesTitle(tab.title || I18n.t("当前视频")),
      url: tab.url || ""
    };
    snapshotCache.set(tabId, { cachedAt: Date.now(), snapshot });
    return snapshot;
  }
}

function resumeEpisodeIsComplete(episode) {
  return (
    Boolean(episode.completed) ||
    Core.calculateProgress(episode.position, episode.duration) >= 80
  );
}

function resumePositionIsUsable(episode) {
  const position = Math.max(0, Number(episode.position) || 0);
  const duration = Math.max(0, Number(episode.duration) || 0);
  if (!position || !duration || position >= duration) {
    return false;
  }
  const nearEndSeconds = Math.min(
    RESUME_NEAR_END_MAX_SECONDS,
    Math.max(
      Math.min(RESUME_NEAR_END_MIN_SECONDS, duration * 0.1),
      duration * 0.02
    )
  );
  return duration - position > nearEndSeconds;
}

function selectResumeTarget(show, episodes) {
  const sorted = episodes
    .filter((episode) => episode.showId === show.id)
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  const currentLabel = Core.normalizeText(show.episodeLabel).toLocaleLowerCase();
  const current =
    sorted.find(
      (episode) =>
        Core.normalizeText(episode.episodeLabel).toLocaleLowerCase() ===
        currentLabel
    ) ||
    (currentLabel
      ? null
      : sorted[0] || null);
  const allComplete =
    sorted.length > 0
      ? sorted.every(resumeEpisodeIsComplete)
      : resumeEpisodeIsComplete(show);

  // An explicit "continue" should not skip a valid current record just
  // because the 80% heuristic already marked it as complete.
  if (current && resumePositionIsUsable(current)) {
    return {
      allComplete,
      canResume: true,
      current,
      target: current
    };
  }

  const unfinished = sorted.find(
    (episode) => !resumeEpisodeIsComplete(episode)
  );
  const target = unfinished || current || sorted[0] || show;
  return {
    allComplete,
    canResume: resumePositionIsUsable(target),
    current,
    target
  };
}

async function waitForTabReady(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let tab = null;

  while (Date.now() < deadline) {
    tab = await getTab(tabId).catch(() => null);
    if (tab && (!tab.status || tab.status === "complete")) {
      return tab;
    }
    await delay(250);
  }

  return tab || getTab(tabId).catch(() => null);
}

async function findReusableTab(url) {
  const tabs = await queryTabs({}).catch(() => []);
  return (
    tabs.find(
      (tab) =>
        tab &&
        tab.id &&
        typeof tab.url === "string" &&
        tab.url === url
    ) || null
  );
}

async function activateTab(tab) {
  if (!tab || !tab.id) {
    return null;
  }
  const activeTab = await updateTab(tab.id, { active: true }).catch(
    () => tab
  );
  await focusWindow(tab.windowId);
  return activeTab || tab;
}

// This function is serialized into the top frame by chrome.scripting.executeScript.
// Keep it self-contained: it cannot reference background.js variables.
function setResumeOverlayInMainWorld(payload) {
  const overlayId = "video-tracker-resume-status";
  const existing = document.getElementById(overlayId);
  const message = String((payload && payload.message) || "");
  if (!message) {
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    return;
  }

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "top:18px",
      "left:50%",
      "transform:translateX(-50%)",
      "max-width:min(520px,calc(100vw - 32px))",
      "padding:10px 16px",
      "border:1px solid rgba(255,255,255,.22)",
      "border-radius:8px",
      "background:rgba(20,23,20,.92)",
      "box-shadow:0 12px 34px rgba(0,0,0,.35)",
      "color:#fff",
      "font:600 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif",
      "text-align:center",
      "pointer-events:none",
      "transition:opacity 180ms ease"
    ].join(";");
    (document.documentElement || document.body).appendChild(overlay);
  }
  overlay.textContent = message;
  overlay.style.opacity = "1";

  const removeAfterMs = Math.max(0, Number(payload && payload.removeAfterMs) || 0);
  if (removeAfterMs) {
    setTimeout(() => {
      const current = document.getElementById(overlayId);
      if (!current) {
        return;
      }
      current.style.opacity = "0";
      setTimeout(() => {
        if (current.parentNode) {
          current.parentNode.removeChild(current);
        }
      }, 220);
    }, removeAfterMs);
  }
}

async function setResumeOverlay(tabId, message, removeAfterMs) {
  await executeScript({
    args: [{ message, removeAfterMs }],
    target: { frameId: 0, tabId },
    world: "MAIN",
    func: setResumeOverlayInMainWorld
  }).catch(() => []);
}

// This function is serialized into every frame by chrome.scripting.executeScript.
// Keep it self-contained: it cannot reference background.js variables.
function seekPlaybackInMainWorld(targetPosition, expectedDuration) {
  const desired = Math.max(0, Number(targetPosition) || 0);
  const baseline = Math.max(0, Number(expectedDuration) || 0);
  const minimumCompatibleDuration =
    baseline >= 180 ? baseline * 0.55 : 0;
  const videos = [];
  const visitedRoots = new Set();
  const visitedVideos = new Set();
  const collectVideos = (root) => {
    if (!root || visitedRoots.has(root)) {
      return;
    }
    visitedRoots.add(root);

    for (const video of root.querySelectorAll("video")) {
      if (!visitedVideos.has(video)) {
        visitedVideos.add(video);
        videos.push(video);
      }
    }
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        collectVideos(element.shadowRoot);
      }
    }
  };
  collectVideos(document);
  let bestVideo = null;
  let bestScore = -Infinity;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    const duration = Number(video.duration);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      continue;
    }

    const durationCompatible =
      !minimumCompatibleDuration || duration >= minimumCompatibleDuration;
    const score =
      (video.__videoTrackerResumeTarget ? 1e13 : 0) +
      (durationCompatible ? 1e12 : 0) +
      (!video.paused && !video.ended ? 1e10 : 0) +
      Math.max(0, rect.width) * Math.max(0, rect.height) +
      Math.min(duration, 10000);
    if (score > bestScore) {
      bestScore = score;
      bestVideo = video;
    }
  }

  if (!bestVideo) {
    return { found: false, seeked: false };
  }
  const duration = Number(bestVideo.duration);
  if (
    minimumCompatibleDuration &&
    duration < minimumCompatibleDuration
  ) {
    return {
      duration,
      found: true,
      reason: "duration-mismatch",
      seeked: false
    };
  }

  const maximumPosition = Math.max(0, duration - 0.5);
  const position = Math.min(desired, maximumPosition);
  const installResumeGuard = (video, targetPosition) => {
    let guard = video.__videoTrackerResumeGuard;
    const now = Date.now();
    if (!guard) {
      guard = {
        active: false,
        expiresAt: 0,
        position: 0,
        restoring: false,
        userInteracted: false
      };
      try {
        video.__videoTrackerResumeGuard = guard;
      } catch (_error) {
        return;
      }

      const isSeekControl = (target) => {
        if (!target || typeof target.closest !== "function") {
          return false;
        }
        return Boolean(
          target.closest(
            [
              "input[type='range']",
              "[role='slider']",
              "[aria-valuenow]",
              "[class*='seek']",
              "[class*='slider']",
              "[class*='progress'][class*='bar']"
            ].join(",")
          )
        );
      };
      const stopForUser = (event) => {
        if (event.type === "keydown") {
          if (
            ![
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
              "PageUp",
              "PageDown"
            ].includes(event.key)
          ) {
            return;
          }
        } else if (!isSeekControl(event.target)) {
          return;
        }
        guard.active = false;
        guard.userInteracted = true;
        const pageGuard = window.__videoTrackerPageResumeGuard;
        if (
          pageGuard &&
          Math.abs(Number(pageGuard.position) - guard.position) <= 2
        ) {
          pageGuard.active = false;
        }
      };
      document.addEventListener("pointerdown", stopForUser, true);
      document.addEventListener("keydown", stopForUser, true);

      const restoreIfReset = () => {
        if (
          !guard.active ||
          guard.userInteracted ||
          guard.restoring ||
          Date.now() > guard.expiresAt
        ) {
          return;
        }
        const currentDuration = Number(video.duration);
        const currentTime = Number(video.currentTime) || 0;
        if (
          !Number.isFinite(currentDuration) ||
          currentDuration <= 0 ||
          guard.position >= currentDuration - 0.5
        ) {
          return;
        }
        const resetThreshold = Math.min(
          6,
          Math.max(1.5, guard.position * 0.03)
        );
        if (currentTime >= resetThreshold) {
          return;
        }

        guard.restoring = true;
        try {
          video.currentTime = Math.min(
            guard.position,
            Math.max(0, currentDuration - 0.5)
          );
          if (video.paused) {
            const playResult = video.play();
            if (playResult && typeof playResult.catch === "function") {
              playResult.catch(() => {});
            }
          }
        } catch (_error) {
          // A replaced media element can reject an old guard seek.
        }
        setTimeout(() => {
          guard.restoring = false;
        }, 500);
      };

      for (const eventName of [
        "loadedmetadata",
        "canplay",
        "playing",
        "seeked",
        "timeupdate"
      ]) {
        video.addEventListener(eventName, restoreIfReset);
      }
    }

    const startingNewGuard =
      !guard.active ||
      now > guard.expiresAt ||
      Math.abs(Number(guard.position) - targetPosition) > 2;
    if (startingNewGuard) {
      guard.userInteracted = false;
    }
    guard.active = true;
    guard.expiresAt = now + 20000;
    guard.position = targetPosition;
  };

  const installPageResumeGuard = (targetPosition) => {
    let pageGuard = window.__videoTrackerPageResumeGuard;
    if (pageGuard && Date.now() > Number(pageGuard.expiresAt || 0)) {
      if (pageGuard.timerId) {
        clearInterval(pageGuard.timerId);
      }
      if (pageGuard.observer) {
        pageGuard.observer.disconnect();
      }
      pageGuard = null;
      window.__videoTrackerPageResumeGuard = null;
    }
    if (!pageGuard) {
      pageGuard = {
        active: false,
        expiresAt: 0,
        observer: null,
        position: 0
      };
      try {
        window.__videoTrackerPageResumeGuard = pageGuard;
      } catch (_error) {
        return;
      }

      const findGuardVideo = () => {
        const videos = [];
        const visitedRoots = new Set();
        const visitedVideos = new Set();
        const visit = (root) => {
          if (!root || visitedRoots.has(root)) {
            return;
          }
          visitedRoots.add(root);
          for (const video of root.querySelectorAll("video")) {
            if (!visitedVideos.has(video)) {
              visitedVideos.add(video);
              videos.push(video);
            }
          }
          for (const element of root.querySelectorAll("*")) {
            if (element.shadowRoot) {
              visit(element.shadowRoot);
            }
          }
        };
        visit(document);
        return (
          videos
            .filter((video) => {
              const duration = Number(video.duration);
              const style = getComputedStyle(video);
              return (
                Number.isFinite(duration) &&
                duration > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden"
              );
            })
            .sort((left, right) => {
              const leftCompatible =
                !minimumCompatibleDuration ||
                Number(left.duration) >= minimumCompatibleDuration;
              const rightCompatible =
                !minimumCompatibleDuration ||
                Number(right.duration) >= minimumCompatibleDuration;
              const score = (video) => {
                const rect = video.getBoundingClientRect();
                return (
                  (Number(video.duration) >= minimumCompatibleDuration
                    ? 1e12
                    : 0) +
                  (!video.paused && !video.ended ? 1e10 : 0) +
                  Math.max(0, rect.width) * Math.max(0, rect.height)
                );
              };
              return (
                Number(rightCompatible) - Number(leftCompatible) ||
                score(right) - score(left)
              );
            })[0] || null
        );
      };

      const restoreGuardVideo = () => {
        if (!pageGuard.active) {
          return;
        }
        if (Date.now() > pageGuard.expiresAt) {
          pageGuard.active = false;
          if (pageGuard.timerId) {
            clearInterval(pageGuard.timerId);
          }
          if (pageGuard.observer) {
            pageGuard.observer.disconnect();
          }
          return;
        }
        const video = findGuardVideo();
        if (!video) {
          return;
        }
        const duration = Number(video.duration);
        if (
          !Number.isFinite(duration) ||
          duration <= 0 ||
          pageGuard.position >= duration - 0.5
        ) {
          return;
        }
        installResumeGuard(video, pageGuard.position);
        const currentTime = Number(video.currentTime) || 0;
        const resetThreshold = Math.min(
          6,
          Math.max(1.5, pageGuard.position * 0.03)
        );
        if (currentTime >= resetThreshold) {
          return;
        }
        try {
          video.currentTime = Math.min(
            pageGuard.position,
            Math.max(0, duration - 0.5)
          );
        } catch (_error) {
          // The page may be replacing the media element.
        }
      };

      const observer = new MutationObserver(restoreGuardVideo);
      pageGuard.observer = observer;
      const root = document.documentElement || document.body;
      if (root) {
        observer.observe(root, { childList: true, subtree: true });
      }
      pageGuard.timerId = setInterval(restoreGuardVideo, 500);
    }

    const now = Date.now();
    const startingNewGuard =
      !pageGuard.active ||
      now > pageGuard.expiresAt ||
      Math.abs(Number(pageGuard.position) - targetPosition) > 2;
    if (startingNewGuard) {
      pageGuard.active = true;
    }
    pageGuard.expiresAt = now + 30000;
    pageGuard.position = targetPosition;
  };

  installPageResumeGuard(position);
  installResumeGuard(bestVideo, position);

  try {
    bestVideo.__videoTrackerResumeTarget = true;
  } catch (_error) {
    // A page may expose a read-only video wrapper.
  }

  const currentTime = Number(bestVideo.currentTime) || 0;
  const tolerance = Math.min(4, Math.max(1, position * 0.01));
  const alreadyThere = currentTime + tolerance >= position;
  if (!alreadyThere) {
    try {
      bestVideo.currentTime = position;
    } catch (_error) {
      return {
        currentTime,
        duration,
        found: true,
        reason: "seek-failed",
        seeked: false
      };
    }
  }

  try {
    bestVideo.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  } catch (_error) {
    // Native seeking already emits the standard media events.
  }

  if (bestVideo.paused) {
    try {
      const playResult = bestVideo.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
    } catch (_error) {
      // Autoplay can be denied; the stored position is still restored.
    }
  }

  return {
    currentTime: Number(bestVideo.currentTime) || currentTime,
    duration,
    found: true,
    guardArmed: true,
    pageGuardArmed: true,
    readyState: Number(bestVideo.readyState) || 0,
    seeked: true
  };
}

async function seekTabPlayback(tabId, position, duration) {
  let lastError = "";
  let lastReason = "";
  let lastMatch = null;
  let stableSamples = 0;

  for (let attempt = 0; attempt < RESUME_SEEK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const results = await executeScript({
        args: [position, duration],
        target: { allFrames: true, tabId },
        world: "MAIN",
        func: seekPlaybackInMainWorld
      });
      const allResults = results
        .map((injection) => injection && injection.result)
        .filter(Boolean);
      const matches = allResults
        .filter((result) => result.found && result.seeked)
        .sort((left, right) => {
          const leftDistance = Math.abs(
            Number(left.currentTime) - Number(position)
          );
          const rightDistance = Math.abs(
            Number(right.currentTime) - Number(position)
          );
          return leftDistance - rightDistance;
        });
      const bestMatch = matches[0] || null;
      if (bestMatch) {
        const matchDuration = Math.max(0, Number(bestMatch.duration) || 0);
        const targetPosition = matchDuration
          ? Math.min(position, Math.max(0, matchDuration - 0.5))
          : position;
        const matchCurrentTime = Math.max(
          0,
          Number(bestMatch.currentTime) || 0
        );
        const tolerance = Math.min(
          4,
          Math.max(1, targetPosition * 0.01)
        );
        if (matchCurrentTime + tolerance >= targetPosition) {
          stableSamples += 1;
          lastMatch = bestMatch;
        } else {
          stableSamples = 0;
        }
      } else {
        stableSamples = 0;
      }

      const durationMismatch = allResults.find(
        (result) => result.reason === "duration-mismatch"
      );
      if (durationMismatch) {
        lastReason = "duration-mismatch";
      }

      if (stableSamples >= RESUME_SEEK_STABLE_SAMPLES && lastMatch) {
        return {
          currentTime: Math.max(
            0,
            Number(lastMatch.currentTime) || position
          ),
          duration: Math.max(0, Number(lastMatch.duration) || 0),
          resumed: true
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < RESUME_SEEK_MAX_ATTEMPTS) {
      await delay(RESUME_SEEK_RETRY_MS);
    }
  }

  return { error: lastError || lastReason, resumed: false };
}

async function resumeShow(message) {
  const showId = limitText(message.id, 80);
  const requestedEpisodeId = limitText(
    message.episodeId || message.episodeStorageKey,
    180
  );
  if (!showId) {
    throw new Error(I18n.t("追踪记录不存在"));
  }

  const [show, storedEpisodes] = await Promise.all([
    getRecord(showId),
    getAllEpisodes()
  ]);
  if (!show) {
    throw new Error(I18n.t("追踪记录不存在"));
  }

  const episodes = synthesizeCurrentEpisodes([show], storedEpisodes);
  const requestedEpisode = requestedEpisodeId
    ? episodes.find(
        (episode) =>
          episode.id === requestedEpisodeId ||
          episode.storageKey === requestedEpisodeId
      ) || null
    : null;
  if (requestedEpisodeId && !requestedEpisode) {
    throw new Error(I18n.t("追踪记录不存在"));
  }
  const selection = requestedEpisode
    ? {
        allComplete: episodes
          .filter((episode) => episode.showId === show.id)
          .every(resumeEpisodeIsComplete),
        canResume: resumePositionIsUsable(requestedEpisode),
        current: requestedEpisode,
        target: requestedEpisode
      }
    : selectResumeTarget(show, episodes);
  const target = selection.target;
  const url = String(target.url || show.url || "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(I18n.t("这条记录没有可打开的页面"));
  }

  let tab = await findReusableTab(url);
  const reusedTab = Boolean(tab);
  if (reusedTab) {
    tab = await activateTab(tab);
  } else {
    tab = await createTab({ active: true, url });
  }
  if (!tab || !tab.id) {
    throw new Error(I18n.t("无法打开观看页面"));
  }

  await waitForTabReady(tab.id, RESUME_TAB_LOAD_TIMEOUT_MS);
  const storedPosition = Math.max(0, Number(target.position) || 0);
  const duration = Math.max(0, Number(target.duration) || 0);
  const shouldResume = selection.canResume;
  const requestedPosition = shouldResume
    ? Math.max(0, storedPosition - RESUME_REWIND_SECONDS)
    : 0;
  if (shouldResume) {
    await setResumeOverlay(
      tab.id,
      I18n.t("正在恢复播放位置 {time}", {
        time: Core.formatTime(requestedPosition)
      })
    );
  }
  const seekResult = shouldResume
    ? await seekTabPlayback(tab.id, requestedPosition, duration)
    : { resumed: false };
  if (seekResult.resumed) {
    await setResumeOverlay(
      tab.id,
      I18n.t("已恢复播放位置 {time}", {
        time: Core.formatTime(seekResult.currentTime)
      }),
      1200
    );
    await maybeResumeTrackedTab(tab.id).catch(() => {});
  } else if (shouldResume) {
    await setResumeOverlay(
      tab.id,
      I18n.t("无法自动恢复播放位置，请拖动进度条到 {time}", {
        time: Core.formatTime(requestedPosition)
      }),
      4200
    );
  }

  return {
    allComplete: selection.allComplete,
    currentTime: seekResult.resumed
      ? seekResult.currentTime
      : storedPosition,
    episodeLabel: target.episodeLabel || show.episodeLabel || "",
    ok: true,
    requestedPosition,
    reusedTab,
    resumed: Boolean(seekResult.resumed),
    tabId: tab.id,
    url
  };
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

function videoSourceKey(value) {
  try {
    const source = new URL(value);
    return `${source.origin}${source.pathname}`;
  } catch (_error) {
    return limitText(value, 600);
  }
}

function sourceLooksLikeAdvertisement(value) {
  const key = videoSourceKey(value);
  return /(^|[/_.-])(ad|ads|advert|advertisement|adplayer|ad-player|preroll|pre-roll|midroll|mid-roll)([/_.-]|$)/i.test(
    key
  );
}

function updateNaturalWatchProgress(session, snapshot, now) {
  const position = Math.max(0, Number(snapshot.currentTime) || 0);
  const lastPosition = Number(session.lastObservedPosition);
  const lastObservedAt = Number(session.lastObservedAt);
  if (Number.isFinite(lastPosition) && Number.isFinite(lastObservedAt)) {
    const delta = position - lastPosition;
    const elapsedSeconds = Math.max(0, (now - lastObservedAt) / 1000);
    const maximumStep = Math.max(5, elapsedSeconds * 3 + 5);
    if (delta > 0 && delta <= maximumStep) {
      session.watchedSeconds =
        (Number(session.watchedSeconds) || 0) +
        Math.min(delta, MAX_WATCH_SAMPLE_MS / 1000);
    }
  }
  session.lastObservedPosition = position;
  session.lastObservedAt = now;
}

function episodeReachedCompletion(snapshot, session) {
  const duration = Math.max(0, Number(snapshot.duration) || 0);
  const position = Math.max(0, Number(snapshot.currentTime) || 0);
  if (!duration) {
    return false;
  }
  if (
    snapshot.ended ||
    (duration > 0 && duration - position <= 1)
  ) {
    return true;
  }
  if (position / duration < COMPLETION_PROGRESS_RATIO) {
    return false;
  }
  const requiredWatchSeconds = Math.min(
    COMPLETION_MIN_WATCH_SECONDS,
    Math.max(60, duration * 0.2)
  );
  return Number(session.watchedSeconds) >= requiredWatchSeconds;
}

function evaluateAdvertisement(snapshot, record, session, now) {
  const duration = Math.max(0, Number(snapshot.duration) || 0);
  const sourceKey = videoSourceKey(snapshot.videoSource || "");
  const baseline = Math.max(
    Number(record && record.duration) || 0,
    Number(session.contentDuration) || 0
  );

  if (snapshot.adDetected) {
    return { blocked: true, reason: snapshot.adReason || "ad-signal" };
  }
  if (sourceLooksLikeAdvertisement(snapshot.videoSource)) {
    return { blocked: true, reason: "ad-source" };
  }
  if (
    snapshot.site === "tencent" &&
    duration > 0 &&
    duration <= AD_DURATION_MAX_SEC
  ) {
    return { blocked: true, reason: "short-duration" };
  }

  if (baseline >= CONTENT_DURATION_MIN_SEC && duration > 0) {
    if (duration <= AD_DURATION_MAX_SEC) {
      return { blocked: true, reason: "duration-drop" };
    }
    if (
      record &&
      snapshotIsSameEpisode(record, snapshot) &&
      duration < baseline * AD_DURATION_DROP_RATIO
    ) {
      return { blocked: true, reason: "duration-drop" };
    }

    const sourceChanged =
      session.contentSourceKey &&
      sourceKey &&
      sourceKey !== session.contentSourceKey;
    const significantDurationChange =
      Math.abs(duration - baseline) / baseline > 0.2;
    if (sourceChanged && significantDurationChange) {
      const observationKey = [
        sourceKey,
        Math.round(duration),
        Core.normalizeText(snapshot.episodeLabel)
      ].join("|");
      if (session.adObservationKey !== observationKey) {
        session.adObservationKey = observationKey;
        session.adObservationSince = now;
      }
      if (
        now - Number(session.adObservationSince || now) <
        AD_STABILITY_MS
      ) {
        return { blocked: true, reason: "unstable-source" };
      }
    }
  }

  session.adObservationKey = "";
  session.adObservationSince = 0;
  if (duration > 0) {
    session.contentDuration = duration;
  }
  if (sourceKey) {
    session.contentSourceKey = sourceKey;
  }
  return { blocked: false, reason: "" };
}

async function startTracking(message) {
  const tabId = Number(message.tabId);
  if (!tabId) {
    throw new Error(I18n.t("没有找到当前标签页"));
  }

  const snapshot = await getTabSnapshot(tabId, { fresh: true });
  if (!snapshot || !snapshot.canTrack) {
    throw new Error(
      snapshot && snapshot.error
        ? I18n.t("无法读取视频：{error}", { error: snapshot.error })
        : I18n.t("当前页面还没有可记录的播放进度")
    );
  }
  await clearTrackingSuppression(tabId);

  const seriesKey =
    limitText(snapshot.seriesKey, 240) ||
    Core.deriveSeriesKey(snapshot.url, snapshot.title);
  const showId = Core.createShowId(seriesKey);
  const existingRecord = await getRecord(showId);
  const candidateRecord = sanitizeRecord({
    ...recordFromSnapshot(snapshot, {
      episodeLabel: message.episodeLabel,
      episodeSource: message.episodeSource,
      id: showId,
      name: message.name || snapshot.title
    }),
    maxWatchedEpisodeLabel: existingRecord?.maxWatchedEpisodeLabel,
    maxWatchedEpisodeNumber: Math.max(
      Number(existingRecord?.maxWatchedEpisodeNumber) || 0,
      Core.parseEpisodeNumber(
        message.episodeLabel || snapshot.episodeLabel
      ) || 0
    ),
    pinned: Boolean(existingRecord && existingRecord.pinned),
    pinnedAt: (existingRecord && existingRecord.pinnedAt) || 0
  });
  const sessions = await loadSessions();
  const now = Date.now();
  const session = {
    adObservationKey: "",
    adObservationSince: 0,
    contentDuration: Number(existingRecord && existingRecord.duration) || 0,
    contentSourceKey: "",
    lastObservedAt: now,
    lastObservedPosition: Number(snapshot.currentTime) || 0,
    lastSyncAt: now,
    seriesKey,
    showId,
    startedAt: now,
    watchedSeconds: 0
  };
  const adGuard = evaluateAdvertisement(snapshot, existingRecord, session, now);
  if (adGuard.blocked) {
    session.pendingRecord = existingRecord ? null : candidateRecord;
    sessions[tabId] = session;
    await saveSessions();
    setBadge(tabId, true);
    createTrackingAlarm();
    return {
      advertisement: true,
      deferredSync: false,
      guardPending: true,
      ok: true,
      reason: adGuard.reason,
      record: existingRecord,
      session
    };
  }

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
      device,
      episodeReachedCompletion(snapshot, session)
    );
    writeResult = await writeRecord(candidateRecord, episodeRecord);
  }

  sessions[tabId] = session;
  await saveSessions();
  setBadge(tabId, true);
  createTrackingAlarm();
  await updateLatestUpdateBadge().catch(() => {});

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

  const storedRecord = await getRecord(session.showId);
  const record =
    storedRecord ||
    (session.pendingRecord ? sanitizeRecord(session.pendingRecord) : null);
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
  const adGuard = evaluateAdvertisement(snapshot, record, session, now);
  sessions[tabId] = session;
  if (adGuard.blocked) {
    session.lastObservedAt = now;
    session.lastObservedPosition = Math.max(
      0,
      Number(snapshot.currentTime) || 0
    );
    await saveSessions();
    return {
      active: true,
      guard: "advertisement",
      reason: adGuard.reason,
      written: false
    };
  }
  updateNaturalWatchProgress(session, snapshot, now);

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

  const completedNow = episodeReachedCompletion(snapshot, session);
  const updated = sanitizeRecord({
    ...record,
    duration: snapshot.duration || record.duration,
    episodeCompleted: Boolean(record.episodeCompleted) || completedNow,
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
  const maxWatchedIncreased =
    Number(updated.maxWatchedEpisodeNumber || 0) >
    Number(record.maxWatchedEpisodeNumber || 0);

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
    device,
    completedNow
  );
  const result = await writeRecord(updated, episodeRecord);
  delete session.pendingRecord;
  session.lastSyncAt = now;
  sessions[tabId] = session;
  await saveSessions();
  if (maxWatchedIncreased) {
    await updateLatestUpdateBadge().catch(() => {});
  }

  return {
    active: true,
    deferredSync: !result.synced,
    written: true
  };
}

async function stopTracking(tabId) {
  const beforeStop = await loadSessions();
  const seriesKey = beforeStop[tabId]?.seriesKey || "";
  await updateTrackedTab(tabId, { force: true }).catch(() => {});
  const sessions = await loadSessions();
  const hadSession = Boolean(sessions[tabId]);
  delete sessions[tabId];
  await saveSessions();
  if (seriesKey) {
    await setTrackingSuppressed(tabId, seriesKey).catch(() => {});
  }
  setBadge(tabId, false);
  return { ok: true, stopped: hadSession };
}

async function updateShow(message) {
  const record = await getRecord(message.id);
  if (!record) {
    throw new Error(I18n.t("追踪记录不存在"));
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

async function setShowPinned(message) {
  const record = await getRecord(message.id);
  if (!record) {
    throw new Error(I18n.t("追踪记录不存在"));
  }

  const pinned = Boolean(message.pinned);
  const now = Math.max(
    Date.now(),
    (Number(record.updatedAt) || 0) + 1,
    (Number(record.pinnedAt) || 0) + 1
  );
  const updated = sanitizeRecord({
    ...record,
    pinned,
    pinnedAt: pinned ? now : 0,
    updatedAt: now
  });
  const result = await writeRecord(updated);
  return {
    deferredSync: !result.synced,
    ok: true,
    record: result.record
  };
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
      key === latestSyncKeyFor(showId) ||
      key.startsWith(`${EPISODE_SYNC_PREFIX}${showId}.`)
  );
  const localKeys = Object.keys(localAll).filter(
    (key) =>
      key === localKeyFor(showId) ||
      key === latestLocalKeyFor(showId) ||
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
  await updateLatestUpdateBadge().catch(() => {});
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
    return { ok: false, error: I18n.t("无效的剧集记录") };
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
  const tabId = Number(message.tabId);
  if (tabId) {
    await maybeResumeTrackedTab(tabId).catch(() => {});
  }
  const [rawRecords, storedEpisodes, latestStates, sessionsResult] =
    await Promise.all([
    getAllRecords(),
    getAllEpisodes(),
    getAllLatestEpisodeStates(),
    loadSessions()
  ]);
  const records = presentRecordsWithLatest(
    await reconcileMaxWatchedEpisodes(rawRecords, storedEpisodes),
    latestStates
  );
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

function createLatestEpisodeAlarm() {
  if (chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create(LATEST_EPISODE_ALARM, {
      periodInMinutes: LATEST_EPISODE_ALARM_PERIOD_MINUTES
    });
  }
}

async function heartbeat() {
  await synchronizeStorage().catch(() => {});
  await updateLatestUpdateBadge().catch(() => {});
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
    case "VT_CHECK_LATEST_EPISODES":
      return checkLatestEpisodes({ force: true });
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
    case "VT_RESUME_SHOW":
      return resumeShow(message);
    case "VT_START_TRACKING":
      return startTracking(message);
    case "VT_STOP_TRACKING":
      return stopTracking(Number(message.tabId));
    case "VT_SYNC_TAB":
      return updateTrackedTab(Number(message.tabId), { force: true });
    case "VT_UPDATE_SHOW":
      return updateShow(message);
    case "VT_SET_SHOW_PINNED":
      return setShowPinned(message);
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
      return maybeResumeTrackedTab(tabId);
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
      return maybeResumeTrackedTab(tabId);
    })
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  snapshotCache.delete(tabId);
  await clearTrackingSuppression(tabId).catch(() => {});
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
  } else if (alarm.name === LATEST_EPISODE_ALARM) {
    checkLatestEpisodes().catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await storageSet(chrome.storage.local, {
    [LOCAL_SCHEMA_KEY]: SCHEMA_VERSION
  }).catch(() => {});
  createTrackingAlarm();
  createLatestEpisodeAlarm();
  await resumeActiveTrackedTabs();
  await heartbeat();
  await checkLatestEpisodes().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  createTrackingAlarm();
  createLatestEpisodeAlarm();
  resumeActiveTrackedTabs()
    .then(() => heartbeat())
    .then(() => checkLatestEpisodes())
    .catch(() => {});
});
