(function initializePopup() {
  "use strict";

  const Core = globalThis.VideoTrackerCore;
  const iconPaths = globalThis.VideoTrackerIconPaths || {};
  const state = {
    deleteId: null,
    device: null,
    editId: null,
    loading: true,
    records: [],
    session: null,
    snapshot: null,
    syncIssue: null,
    syncState: null,
    tabId: null,
    toastTimer: null
  };

  const elements = {
    currentContent: document.getElementById("currentContent"),
    deleteDialog: document.getElementById("deleteDialog"),
    deleteError: document.getElementById("deleteError"),
    deleteForm: document.getElementById("deleteForm"),
    deleteName: document.getElementById("deleteName"),
    editAuto: document.getElementById("editAuto"),
    editDialog: document.getElementById("editDialog"),
    editEpisode: document.getElementById("editEpisode"),
    editError: document.getElementById("editError"),
    editForm: document.getElementById("editForm"),
    editName: document.getElementById("editName"),
    libraryContent: document.getElementById("libraryContent"),
    libraryCount: document.getElementById("libraryCount"),
    manageButton: document.getElementById("manageButton"),
    playbackState: document.getElementById("playbackState"),
    playbackText: document.getElementById("playbackText"),
    syncLabel: document.getElementById("syncLabel"),
    syncState: document.getElementById("syncState"),
    toast: document.getElementById("toast")
  };

  function escapeHtml(value) {
    const container = document.createElement("div");
    container.textContent = String(value == null ? "" : value);
    return container.innerHTML;
  }

  function escapeAttr(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function iconMarkup(name, size) {
    const content = iconPaths[name] || "";
    const pixelSize = Number(size) || 18;
    return `<svg viewBox="0 0 24 24" width="${pixelSize}" height="${pixelSize}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
  }

  function hydrateIcons(root) {
    const scope = root || document;
    for (const placeholder of scope.querySelectorAll("[data-icon]")) {
      if (placeholder.firstElementChild) {
        continue;
      }
      const size = placeholder.dataset.iconSize || 18;
      placeholder.innerHTML = iconMarkup(placeholder.dataset.icon, size);
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  function sendRuntime(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message, ok: false });
            return;
          }
          resolve(response || { ok: false });
        });
      } catch (error) {
        resolve({ error: error.message, ok: false });
      }
    });
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function createTab(url) {
    return new Promise((resolve) => {
      chrome.tabs.create({ url }, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab);
      });
    });
  }

  function showToast(message, isError) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-error", Boolean(isError));
    elements.toast.classList.add("is-visible");
    state.toastTimer = setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2800);
  }

  function showInlineError(element, message) {
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.hidden = !message;
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) {
      return;
    }
    if (busy) {
      button.dataset.originalLabel = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `${iconMarkup("loader-circle", 17)}<span>${escapeHtml(busyLabel || "处理中")}</span>`;
      return;
    }

    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.innerHTML = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  function trackingCurrentVideo() {
    return Boolean(
      state.session &&
        state.snapshot &&
        state.session.seriesKey === state.snapshot.seriesKey
    );
  }

  function currentRecord() {
    if (!state.session) {
      return null;
    }
    return state.records.find((record) => record.id === state.session.showId) || null;
  }

  function updateSyncState() {
    const sync = state.syncState || {};
    const status = sync.status || (state.syncIssue ? "error" : "unknown");
    const synced = status === "synced";
    const failed = status === "error";
    const pending = Number(sync.pending) || 0;
    elements.syncState.classList.toggle("is-local", failed);
    elements.syncState.classList.toggle("is-warning", !synced && !failed);
    elements.syncLabel.textContent = synced
      ? "本地云端已对齐"
      : failed
        ? "同步失败"
        : "本地未同步";
    elements.syncState.setAttribute(
      "aria-label",
      synced
        ? "本地存储和云端存储已同步"
        : failed
          ? "浏览器同步存储不可用"
          : "本地记录尚未同步到云端"
    );
    elements.syncState.title = synced
      ? "本地存储与云端存储已对齐"
      : failed
        ? sync.error || "浏览器同步存储不可用"
        : `有 ${pending} 条本地记录尚未上传`;
  }

  function updatePlaybackState() {
    const snapshot = state.snapshot;
    if (!snapshot || !snapshot.hasVideo) {
      elements.playbackState.hidden = true;
      return;
    }

    elements.playbackState.hidden = false;
    elements.playbackState.classList.toggle(
      "is-paused",
      Boolean(snapshot.paused) && !snapshot.ended
    );
    elements.playbackState.classList.toggle("is-ended", Boolean(snapshot.ended));

    if (snapshot.ended) {
      elements.playbackText.textContent = "已播完";
    } else if (snapshot.paused) {
      elements.playbackText.textContent = "已暂停";
    } else {
      elements.playbackText.textContent = "播放中";
    }
  }

  function progressMarkup(position, duration, compact) {
    const progress = Core.calculateProgress(position, duration);
    const fraction = progress / 100;
    if (compact) {
      return `<div class="mini-progress" style="--progress:${fraction}" aria-hidden="true"><span></span></div>`;
    }
    return `
      <div class="progress-row">
        <div
          class="progress-track"
          role="progressbar"
          aria-label="本集观看进度"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${progress}"
          data-live-progress="${progress}"
          style="--progress:${fraction}"
        >
          <span class="progress-fill"></span>
        </div>
        <span class="progress-value" data-live-percent>${Math.round(progress)}%</span>
      </div>
    `;
  }

  function liveTimeText(snapshot) {
    return `${Core.formatTime(snapshot.currentTime)} / ${Core.formatTime(snapshot.duration)}`;
  }

  function renderEmptyCurrent(snapshot) {
    const detail =
      snapshot && snapshot.error && snapshot.error !== "当前页面不支持视频检测"
        ? "播放器暂时无法读取，请稍后重新检测。"
        : "打开视频播放页后重新检测。";
    elements.currentContent.innerHTML = `
      <div class="empty-current">
        <span class="empty-icon">${iconMarkup("monitor-play", 24)}</span>
        <h1>没有检测到视频</h1>
        <p>${escapeHtml(detail)}</p>
        <button class="text-button" type="button" data-action="retry">
          ${iconMarkup("refresh-cw", 15)}
          <span>重新检测</span>
        </button>
      </div>
    `;
  }

  function renderWaitingCurrent(snapshot) {
    elements.currentContent.innerHTML = `
      <div class="waiting-state">
        <span class="empty-icon">${iconMarkup("clock", 23)}</span>
        <h1>${escapeHtml(snapshot.title || "视频正在加载")}</h1>
        <p>等待播放器返回时长后即可记录进度。</p>
        <button class="text-button" type="button" data-action="retry">
          ${iconMarkup("refresh-cw", 15)}
          <span>重新检测</span>
        </button>
      </div>
    `;
  }

  function renderActiveCurrent(snapshot, record) {
    const episodeLabel =
      record && record.episodeSource === "manual"
        ? record.episodeLabel
        : snapshot.episodeLabel || (record && record.episodeLabel) || "集数待识别";
    const duration = snapshot.duration || (record && record.duration) || 0;
    const position = snapshot.currentTime;
    const name = (record && record.name) || snapshot.title || "当前视频";
    const editButton = record
      ? `
        <button
          class="icon-button"
          type="button"
          data-action="edit"
          data-id="${escapeAttr(record.id)}"
          aria-label="编辑${escapeAttr(name)}"
          title="编辑记录"
        >
          ${iconMarkup("pencil", 17)}
        </button>
      `
      : "";

    elements.currentContent.innerHTML = `
      <div class="active-summary">
        <div class="title-line">
          <span class="site-badge">${escapeHtml(snapshot.siteLabel || "网页视频")}</span>
          <span class="tracking-badge">
            ${iconMarkup("check", 13)}
            <span>追踪中</span>
          </span>
        </div>
        <h1 class="video-title">${escapeHtml(name)}</h1>
        <div class="active-meta">
          <div class="episode-stack">
            <strong>${escapeHtml(episodeLabel)}</strong>
            <span>
              已看
              <span data-live-time>${escapeHtml(liveTimeText(snapshot))}</span>
            </span>
          </div>
        </div>
        ${progressMarkup(position, duration, false)}
        <div class="active-actions">
          <button class="button button-secondary button-small" id="stopTracking" type="button">
            ${iconMarkup("circle-stop", 17)}
            <span>停止追踪</span>
          </button>
          ${editButton}
        </div>
      </div>
    `;
  }

  function renderStartForm(snapshot) {
    const replacing = Boolean(state.session);
    const name = snapshot.title || "";
    const episode = snapshot.episodeLabel || "";
    const currentFraction = Core.calculateProgress(snapshot.currentTime, snapshot.duration) / 100;

    elements.currentContent.innerHTML = `
      <form class="track-form" id="trackForm" novalidate>
        <div class="title-line">
          <span class="site-badge">${escapeHtml(snapshot.siteLabel || "网页视频")}</span>
          <span class="live-time">
            ${iconMarkup("clock", 14)}
            <span data-live-time>${escapeHtml(liveTimeText(snapshot))}</span>
          </span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>剧名</span>
            <input
              id="trackName"
              name="name"
              maxlength="100"
              autocomplete="off"
              value="${escapeAttr(name)}"
              required
            >
          </label>
          <label class="field">
            <span>集数</span>
            <input
              id="trackEpisode"
              name="episode"
              maxlength="40"
              autocomplete="off"
              value="${escapeAttr(episode)}"
              data-detected-episode="${escapeAttr(episode)}"
              placeholder="待识别"
            >
          </label>
        </div>
        <div class="progress-row">
          <div
            class="progress-track"
            role="progressbar"
            aria-label="本集观看进度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${currentFraction * 100}"
            data-live-progress="${currentFraction * 100}"
            style="--progress:${currentFraction}"
          >
            <span class="progress-fill"></span>
          </div>
          <span class="progress-value" data-live-percent>${Math.round(currentFraction * 100)}%</span>
        </div>
        <button class="button button-primary" id="startTracking" type="submit">
          ${iconMarkup("play", 17)}
          <span>${replacing ? "改为追踪当前视频" : "开始追踪"}</span>
        </button>
        <p class="form-error" id="trackError" role="alert" hidden></p>
      </form>
    `;
  }

  function renderCurrent() {
    updatePlaybackState();
    const snapshot = state.snapshot;

    if (state.loading) {
      return;
    }

    if (!snapshot || !snapshot.hasVideo) {
      renderEmptyCurrent(snapshot);
      return;
    }

    if (!snapshot.canTrack) {
      renderWaitingCurrent(snapshot);
      return;
    }

    if (trackingCurrentVideo()) {
      renderActiveCurrent(snapshot, currentRecord());
      return;
    }

    renderStartForm(snapshot);
  }

  function siteInitial(site, label) {
    const initials = {
      bilibili: "B",
      iqiyi: "i",
      mgtv: "M",
      netflix: "N",
      tencent: "T",
      youtube: "Y",
      youku: "Y"
    };
    if (initials[site]) {
      return initials[site];
    }
    return String(label || "V").trim().charAt(0).toUpperCase() || "V";
  }

  function renderLibrary() {
    elements.libraryCount.textContent = `${state.records.length} 部`;

    if (!state.records.length) {
      elements.libraryContent.innerHTML = `
        <div class="library-empty">
          ${iconMarkup("film", 18)}
          <span>还没有追踪记录</span>
        </div>
      `;
      return;
    }

    const activeId = trackingCurrentVideo() ? state.session.showId : null;
    const rows = state.records
      .map((record) => {
        const progress = Core.calculateProgress(record.position, record.duration);
        const positionLabel = Core.formatTime(record.position);
        const episodeLabel = record.episodeLabel || "集数待识别";
        const isCurrent = record.id === activeId;
        return `
          <article class="show-row">
            <span
              class="show-marker"
              data-site="${escapeAttr(record.site)}"
              aria-hidden="true"
            >${escapeHtml(siteInitial(record.site, record.siteLabel))}</span>
            <button
              class="show-main"
              type="button"
              data-action="open"
              data-id="${escapeAttr(record.id)}"
              aria-label="打开${escapeAttr(record.name)}"
              title="打开上次观看页面"
            >
              <span class="show-name-line">
                <span class="show-name">${escapeHtml(record.name)}</span>
                ${isCurrent ? "<span class=\"current-tag\">当前</span>" : ""}
              </span>
              <span class="show-meta">
                <span class="episode">${escapeHtml(episodeLabel)}</span>
                <span class="meta-separator">·</span>
                <span>看到 ${escapeHtml(positionLabel)}</span>
                <span class="meta-separator">·</span>
                <span>${Math.round(progress)}%</span>
              </span>
              ${progressMarkup(record.position, record.duration, true)}
            </button>
            <button
              class="icon-button"
              type="button"
              data-action="edit"
              data-id="${escapeAttr(record.id)}"
              aria-label="编辑${escapeAttr(record.name)}"
              title="编辑记录"
            >
              ${iconMarkup("pencil", 16)}
            </button>
            <button
              class="icon-button is-danger"
              type="button"
              data-action="delete"
              data-id="${escapeAttr(record.id)}"
              aria-label="删除${escapeAttr(record.name)}"
              title="删除记录"
            >
              ${iconMarkup("trash-2", 16)}
            </button>
          </article>
        `;
      })
      .join("");

    elements.libraryContent.innerHTML = `<div class="library-list">${rows}</div>`;
  }

  function renderAll() {
    updateSyncState();
    renderCurrent();
    renderLibrary();
  }

  function updateLiveDetails(snapshot) {
    const timeText = liveTimeText(snapshot);
    for (const node of document.querySelectorAll("[data-live-time]")) {
      node.textContent = timeText;
    }

    const progress = Core.calculateProgress(snapshot.currentTime, snapshot.duration);
    for (const node of document.querySelectorAll("[data-live-progress]")) {
      node.style.setProperty("--progress", String(progress / 100));
      node.setAttribute("aria-valuenow", String(progress));
    }
    for (const node of document.querySelectorAll("[data-live-percent]")) {
      node.textContent = `${Math.round(progress)}%`;
    }
  }

  async function refreshLiveSnapshot() {
    if (!state.tabId) {
      return;
    }

    const snapshot = await sendRuntime({
      tabId: state.tabId,
      type: "VT_GET_SNAPSHOT"
    });
    if (!snapshot) {
      return;
    }

    const previous = state.snapshot;
    state.snapshot = snapshot;

    const structuralChange =
      !previous ||
      previous.seriesKey !== snapshot.seriesKey ||
      previous.episodeLabel !== snapshot.episodeLabel ||
      previous.hasVideo !== snapshot.hasVideo ||
      previous.canTrack !== snapshot.canTrack;

    updatePlaybackState();
    if (structuralChange) {
      renderCurrent();
      renderLibrary();
      return;
    }

    updateLiveDetails(snapshot);
  }

  async function fetchSnapshotWithRetry(tabId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await sendRuntime({
        tabId,
        type: "VT_GET_SNAPSHOT"
      });
      if (snapshot) {
        return snapshot;
      }
      await delay(350);
    }
    return null;
  }

  async function refreshApp(options) {
    const settings = options || {};
    const appState = await sendRuntime({
      tabId: state.tabId,
      type: "VT_GET_APP_STATE"
    });

    if (!appState.ok) {
      throw new Error(appState.error || "无法读取追踪记录");
    }

    state.records = Array.isArray(appState.records) ? appState.records : [];
    state.session = appState.session || null;
    state.syncIssue = appState.syncIssue || null;
    state.syncState = appState.syncState || null;
    state.device = appState.device || state.device;

    if (settings.refreshSnapshot !== false) {
      state.snapshot = await fetchSnapshotWithRetry(state.tabId);
    }
    state.loading = false;
    if (settings.renderCurrent === false) {
      updateSyncState();
      updatePlaybackState();
      renderLibrary();
    } else {
      renderAll();
    }
  }

  async function loadInitial() {
    try {
      const tab = await queryActiveTab();
      if (!tab || !tab.id) {
        state.loading = false;
        state.snapshot = null;
        renderAll();
        return;
      }

      state.tabId = tab.id;
      if (globalThis.VideoTrackerDeviceProfile) {
        state.device = await globalThis.VideoTrackerDeviceProfile.ensure().catch(
          () => null
        );
      }
      await refreshApp({ refreshSnapshot: true });
    } catch (error) {
      state.loading = false;
      showToast(error.message || "扩展初始化失败", true);
      renderAll();
    }
  }

  async function startTracking(form) {
    const nameInput = form.querySelector("#trackName");
    const episodeInput = form.querySelector("#trackEpisode");
    const button = form.querySelector("#startTracking");
    const errorElement = form.querySelector("#trackError");
    const name = Core.normalizeText(nameInput.value);
    const episodeLabel = Core.normalizeText(episodeInput.value);

    showInlineError(errorElement, "");
    if (!name) {
      showInlineError(errorElement, "请填写剧名");
      nameInput.focus();
      return;
    }

    setButtonBusy(button, true, "正在开始");
    const detected = Core.normalizeText(episodeInput.dataset.detectedEpisode);
    const response = await sendRuntime({
      episodeLabel,
      episodeSource: episodeLabel === detected ? "auto" : "manual",
      name,
      tabId: state.tabId,
      type: "VT_START_TRACKING"
    });

    if (!response.ok) {
      setButtonBusy(button, false);
      showInlineError(errorElement, response.error || "无法开始追踪");
      return;
    }

    await refreshApp({ refreshSnapshot: true });
    showToast(response.deferredSync ? "已记录，当前保存在本机" : "已开始追踪");
  }

  async function stopTracking(button) {
    setButtonBusy(button, true, "正在停止");
    const response = await sendRuntime({
      tabId: state.tabId,
      type: "VT_STOP_TRACKING"
    });

    if (!response.ok) {
      setButtonBusy(button, false);
      showToast(response.error || "无法停止追踪", true);
      return;
    }

    await refreshApp({ refreshSnapshot: true });
    showToast("已停止追踪，记录已保留");
  }

  async function openRecord(recordId) {
    const record = state.records.find((item) => item.id === recordId);
    if (!record || !record.url) {
      showToast("这条记录没有可打开的页面", true);
      return;
    }

    const tab = await createTab(record.url);
    if (!tab) {
      showToast("无法打开观看页面", true);
      return;
    }
    window.close();
  }

  function openEditDialog(recordId) {
    const record = state.records.find((item) => item.id === recordId);
    if (!record) {
      return;
    }

    state.editId = record.id;
    elements.editName.value = record.name;
    elements.editEpisode.value = record.episodeLabel || "";
    elements.editAuto.checked = record.episodeSource !== "manual";
    elements.editEpisode.disabled = elements.editAuto.checked;
    setButtonBusy(document.getElementById("editSave"), false);
    showInlineError(elements.editError, "");
    elements.editDialog.showModal();
    elements.editName.focus();
  }

  function openDeleteDialog(recordId) {
    const record = state.records.find((item) => item.id === recordId);
    if (!record) {
      return;
    }

    state.deleteId = record.id;
    elements.deleteName.textContent = record.name;
    setButtonBusy(document.getElementById("deleteConfirm"), false);
    showInlineError(elements.deleteError, "");
    elements.deleteDialog.showModal();
  }

  async function saveEdit(event) {
    event.preventDefault();
    const name = Core.normalizeText(elements.editName.value);
    if (!name) {
      showInlineError(elements.editError, "请填写剧名");
      elements.editName.focus();
      return;
    }

    let episodeLabel = Core.normalizeText(elements.editEpisode.value);
    const auto = elements.editAuto.checked;
    if (auto && state.snapshot) {
      const record = state.records.find((item) => item.id === state.editId);
      if (record && record.seriesKey === state.snapshot.seriesKey && state.snapshot.episodeLabel) {
        episodeLabel = state.snapshot.episodeLabel;
      }
    }

    const saveButton = document.getElementById("editSave");
    setButtonBusy(saveButton, true, "保存中");
    const response = await sendRuntime({
      episodeLabel,
      episodeSource: auto ? "auto" : "manual",
      id: state.editId,
      name,
      type: "VT_UPDATE_SHOW"
    });

    if (!response.ok) {
      setButtonBusy(saveButton, false);
      showInlineError(elements.editError, response.error || "保存失败");
      return;
    }

    setButtonBusy(saveButton, false);
    elements.editDialog.close();
    await refreshApp({ refreshSnapshot: false });
    showToast(response.deferredSync ? "已保存到本机" : "记录已更新");
  }

  async function confirmDelete(event) {
    event.preventDefault();
    const button = document.getElementById("deleteConfirm");
    setButtonBusy(button, true, "删除中");
    const response = await sendRuntime({
      id: state.deleteId,
      type: "VT_DELETE_SHOW"
    });

    if (!response.ok) {
      setButtonBusy(button, false);
      showInlineError(elements.deleteError, response.error || "删除失败");
      return;
    }

    setButtonBusy(button, false);
    elements.deleteDialog.close();
    await refreshApp({ refreshSnapshot: false });
    showToast("记录已删除");
  }

  async function retryDetection() {
    const snapshot = await sendRuntime({
      tabId: state.tabId,
      type: "VT_GET_SNAPSHOT"
    });
    state.snapshot = snapshot;
    renderCurrent();
    updatePlaybackState();
    if (!snapshot) {
      showToast("当前页面无法读取视频", true);
    }
  }

  async function handleClick(event) {
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      const dialog = document.getElementById(closeButton.dataset.closeDialog);
      if (dialog) {
        dialog.close();
      }
      return;
    }

    if (event.target.closest("#stopTracking")) {
      await stopTracking(event.target.closest("#stopTracking"));
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const recordId = actionButton.dataset.id;
    if (action === "retry") {
      await retryDetection();
    } else if (action === "open") {
      await openRecord(recordId);
    } else if (action === "edit") {
      openEditDialog(recordId);
    } else if (action === "delete") {
      openDeleteDialog(recordId);
    }
  }

  async function handleSubmit(event) {
    if (event.target.id === "trackForm") {
      event.preventDefault();
      await startTracking(event.target);
    } else if (event.target.id === "editForm") {
      await saveEdit(event);
    } else if (event.target.id === "deleteForm") {
      await confirmDelete(event);
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit);
    elements.manageButton.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    });

    elements.editAuto.addEventListener("change", () => {
      elements.editEpisode.disabled = elements.editAuto.checked;
      if (!elements.editAuto.checked) {
        elements.editEpisode.focus();
      }
    });

    for (const dialog of [elements.editDialog, elements.deleteDialog]) {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      });
    }

    if (chrome.storage && chrome.storage.onChanged) {
      let storageRefreshTimer = null;
      chrome.storage.onChanged.addListener((changes, areaName) => {
        const relevant = Object.keys(changes || {}).some(
          (key) =>
            key.startsWith("vt.show.") ||
            key.startsWith("vt.local.show.") ||
            key === "vt.syncIssue"
        );
        if (!relevant || !state.tabId) {
          return;
        }

        clearTimeout(storageRefreshTimer);
        storageRefreshTimer = setTimeout(async () => {
          try {
            await refreshApp({ refreshSnapshot: false, renderCurrent: false });
          } catch (_error) {
            // The next explicit action or popup open will retry.
          }
        }, 180);
      });
    }
  }

  hydrateIcons(document);
  bindEvents();
  loadInitial();

  setInterval(refreshLiveSnapshot, 2000);
  setInterval(() => {
    if (state.records.length) {
      renderLibrary();
    }
  }, 30000);
})();
