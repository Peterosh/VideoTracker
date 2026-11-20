(function initializeLibraryPage() {
  "use strict";

  const Core = globalThis.VideoTrackerCore;
  const I18n = globalThis.VideoTrackerI18n;
  const iconPaths = globalThis.VideoTrackerIconPaths || {};
  const languageLabels = { en: "English", zh: "中文" };
  const state = {
    actionPointerGuard: null,
    device: null,
    devices: [],
    episodes: [],
    filter: "all",
    languageMenuOpen: false,
    networkInfoEnabled: false,
    pendingDelete: null,
    pinPending: new Set(),
    pinPointerActive: false,
    pinRenderPending: false,
    query: "",
    resumePendingShowId: null,
    selectedShowId: null,
    shows: [],
    syncIssue: null,
    syncState: null,
    toastTimer: null,
    view: "library"
  };
  let lastShowsRenderSignature = "";

  const elements = {
    cancelDeleteButton: document.getElementById("cancelDeleteButton"),
    cancelDeleteSecondary: document.getElementById("cancelDeleteSecondary"),
    confirmDeleteButton: document.getElementById("confirmDeleteButton"),
    detailPanel: document.getElementById("detailPanel"),
    deviceCount: document.getElementById("deviceCount"),
    deviceList: document.getElementById("deviceList"),
    deviceNetworkState: document.getElementById("deviceNetworkState"),
    devicesTab: document.getElementById("devicesTab"),
    devicesView: document.getElementById("devicesView"),
    languageButton: document.getElementById("languageButton"),
    languageCurrent: document.getElementById("languageCurrent"),
    languageMenu: document.getElementById("languageMenu"),
    languageOptions: document.getElementById("languageOptions"),
    languageOptionButtons: Array.from(
      document.querySelectorAll("[data-language]")
    ),
    libraryTab: document.getElementById("libraryTab"),
    libraryView: document.getElementById("libraryView"),
    networkInfoToggle: document.getElementById("networkInfoToggle"),
    deleteDialog: document.getElementById("deleteDialog"),
    deleteError: document.getElementById("deleteError"),
    deleteForm: document.getElementById("deleteForm"),
    deleteMessage: document.getElementById("deleteMessage"),
    exportButton: document.getElementById("exportButton"),
    importButton: document.getElementById("importButton"),
    importFile: document.getElementById("importFile"),
    refreshButton: document.getElementById("refreshButton"),
    showCount: document.getElementById("showCount"),
    showSearch: document.getElementById("showSearch"),
    showsList: document.getElementById("showsList"),
    syncLastTime: document.getElementById("syncLastTime"),
    syncExtensionId: document.getElementById("syncExtensionId"),
    syncNowButton: document.getElementById("syncNowButton"),
    syncResultBadge: document.getElementById("syncResultBadge"),
    syncStateText: document.getElementById("syncStateText"),
    syncState: document.getElementById("syncState"),
    syncSummary: document.getElementById("syncSummary"),
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

  function hydrateIcons() {
    for (const placeholder of document.querySelectorAll("[data-icon]")) {
      if (placeholder.firstElementChild) {
        continue;
      }
      placeholder.innerHTML = iconMarkup(
        placeholder.dataset.icon,
        placeholder.dataset.iconSize
      );
    }
  }

  function sendRuntime(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message, ok: false });
          return;
        }
        resolve(response || { ok: false });
      });
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
      if (!chrome.tabs || typeof chrome.tabs.query !== "function") {
        resolve([]);
        return;
      }
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  function createTab(properties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(properties, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!tab || !tab.id) {
          reject(new Error(I18n.t("无法打开观看页面")));
          return;
        }
        resolve(tab);
      });
    });
  }

  function updateTab(tabId, properties) {
    return new Promise((resolve, reject) => {
      if (!chrome.tabs || typeof chrome.tabs.update !== "function") {
        reject(new Error(I18n.t("无法打开观看页面")));
        return;
      }
      chrome.tabs.update(tabId, properties, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
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

  function urlsMatch(left, right) {
    if (!left || !right) {
      return false;
    }
    if (left === right) {
      return true;
    }
    try {
      const first = new URL(left);
      const second = new URL(right);
      if (first.hash || second.hash) {
        return first.href === second.href;
      }
      return (
        first.origin === second.origin &&
        first.pathname.replace(/\/$/, "") ===
          second.pathname.replace(/\/$/, "") &&
        first.search === second.search
      );
    } catch (_error) {
      return false;
    }
  }

  async function focusOpenTab(url) {
    const tabs = await queryTabs({}).catch(() => []);
    const existing = tabs.find(
      (tab) =>
        tab.id &&
        (urlsMatch(tab.url, url) || urlsMatch(tab.pendingUrl, url))
    );
    if (!existing) {
      return false;
    }
    try {
      const activeTab = await updateTab(existing.id, { active: true });
      await focusWindow(activeTab?.windowId || existing.windowId);
      return Boolean(activeTab);
    } catch (_error) {
      return false;
    }
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

  function siteInitial(site, label) {
    const initials = {
      bilibili: "B",
      iqiyi: "i",
      mgtv: "M",
      netflix: "N",
      omofun: "O",
      tencent: "T",
      youtube: "Y",
      youku: "Y"
    };
    return initials[site] || String(label || "V").trim().charAt(0).toUpperCase() || "V";
  }

  function formatDate(timestamp) {
    if (!timestamp) {
      return "暂无记录";
    }
    return new Intl.DateTimeFormat(I18n.locale, {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(timestamp));
  }

  function formatTotalDuration(seconds) {
    const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
    if (totalMinutes < 60) {
      return I18n.t("{minutes} 分钟", { minutes: totalMinutes });
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes
      ? I18n.t("{hours} 小时 {minutes} 分", { hours, minutes })
      : I18n.t("{hours} 小时", { hours });
  }

  function maxWatchedLabel(show) {
    const label =
      show.maxWatchedEpisodeLabel ||
      (Number(show.maxWatchedEpisodeNumber) > 0
        ? Core.episodeLabelFromNumber(show.maxWatchedEpisodeNumber)
        : "");
    return label ? I18n.episodeLabel(label) : "--";
  }

  function latestEpisodeLabel(show) {
    const label =
      show.latestEpisodeLabel ||
      (Number(show.latestEpisodeNumber) > 0
        ? Core.episodeLabelFromNumber(show.latestEpisodeNumber)
        : "");
    return label ? I18n.episodeLabel(label) : I18n.t("未知");
  }

  function localizeLatestCheckError(error) {
    const source = String(error || "").trim();
    if (!source) {
      return "";
    }
    const statusMatch = source.match(/^网站返回错误\s+(\d+)$/);
    if (statusMatch) {
      return I18n.t("网站返回错误 {status}", { status: statusMatch[1] });
    }
    return I18n.t(source);
  }

  function isComplete(episode) {
    return (
      Boolean(episode.completed) ||
      Core.calculateProgress(episode.position, episode.duration) >= 80
    );
  }

  function getEpisodesForShow(showId) {
    return state.episodes
      .filter((episode) => episode.showId === showId)
      .sort((left, right) => {
        const leftNumber = Core.parseEpisodeNumber(left.episodeLabel);
        const rightNumber = Core.parseEpisodeNumber(right.episodeLabel);
        if (leftNumber != null && rightNumber != null && leftNumber !== rightNumber) {
          return rightNumber - leftNumber;
        }
        return Number(right.updatedAt) - Number(left.updatedAt);
      });
  }

  function showMatchesQuery(show, query) {
    if (!query) {
      return true;
    }
    const haystack = [
      show.name,
      show.pageTitle,
      show.episodeLabel,
      show.maxWatchedEpisodeLabel,
      show.maxWatchedEpisodeNumber,
      show.latestEpisodeLabel,
      show.latestEpisodeNumber,
      show.siteLabel,
      ...getEpisodesForShow(show.id).flatMap((episode) => [
        episode.episodeLabel,
        episode.pageTitle,
        episode.deviceName,
        episode.deviceIp,
        episode.devicePublicIp
      ])
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(query);
  }

  function sortShows(records) {
    return [...records].sort((left, right) => {
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

  function applyPendingPinState(records) {
    return sortShows(
      records.map((show) => {
        if (!state.pinPending.has(show.id)) {
          return show;
        }
        const optimistic = state.shows.find((item) => item.id === show.id);
        return optimistic
          ? {
              ...show,
              pinned: optimistic.pinned,
              pinnedAt: optimistic.pinnedAt
            }
          : show;
      })
    );
  }

  function getVisibleShows() {
    const query = Core.normalizeText(state.query).toLocaleLowerCase();
    return sortShows(
      state.shows.filter((show) => showMatchesQuery(show, query))
    );
  }

  function updateSyncState() {
    const syncState = state.syncState || {};
    const status = syncState.status || (state.syncIssue ? "error" : "unknown");
    const synced = status === "synced";
    const failed = status === "error";
    const pending = Number(syncState.pending) || 0;
    const cloudShows = Number(syncState.cloudShows) || 0;
    const cloudEpisodes = Number(syncState.cloudEpisodes) || 0;
    elements.syncState.classList.toggle("is-local", !synced);
    elements.syncState.classList.toggle("is-warning", !synced && !failed);
    elements.syncStateText.textContent = synced
      ? I18n.t("本地与云端已对齐")
      : failed
        ? I18n.t("本地与云端未对齐")
        : I18n.t("正在等待同步");
    elements.syncResultBadge.textContent = synced
      ? I18n.t("已同步")
      : failed
        ? I18n.t("同步失败")
        : I18n.t("未同步");
    elements.syncResultBadge.className = `sync-result${
      synced ? " is-ok" : failed ? " is-error" : ""
    }`;
    elements.syncSummary.textContent = failed
      ? syncState.error || I18n.t("无法访问浏览器同步存储")
      : I18n.t(
          "云端 {shows} 部剧、{episodes} 集记录；本地待上传 {pending} 条。",
          { episodes: cloudEpisodes, pending, shows: cloudShows }
        );
    elements.syncLastTime.textContent = syncState.lastSyncAt
      ? I18n.relativeTime(syncState.lastSyncAt)
      : I18n.t("尚未同步");
    elements.syncExtensionId.textContent = chrome.runtime.id || "";
    elements.syncState.title = synced
      ? I18n.t("本地存储与浏览器同步存储已对齐")
      : failed
        ? syncState.error || I18n.t("浏览器同步存储不可用")
        : I18n.t("有 {pending} 条本地记录尚未上传", { pending });
  }

  function updateNetworkState() {
    elements.networkInfoToggle.checked = Boolean(state.networkInfoEnabled);
    elements.deviceNetworkState.textContent = I18n.t(
      state.networkInfoEnabled ? "网络信息已开启" : "网络信息已关闭"
    );
    elements.deviceNetworkState.classList.toggle(
      "is-active",
      Boolean(state.networkInfoEnabled)
    );
  }

  function updateLanguageMenu() {
    elements.languageCurrent.textContent =
      languageLabels[I18n.language] || languageLabels.zh;
    for (const button of elements.languageOptionButtons) {
      button.setAttribute(
        "aria-selected",
        String(button.dataset.language === I18n.language)
      );
    }
  }

  function setLanguageMenuOpen(open, focusOption) {
    state.languageMenuOpen = Boolean(open);
    elements.languageMenu.classList.toggle(
      "is-open",
      state.languageMenuOpen
    );
    elements.languageButton.setAttribute(
      "aria-expanded",
      String(state.languageMenuOpen)
    );
    elements.languageOptions.hidden = !state.languageMenuOpen;
    if (!state.languageMenuOpen) {
      return;
    }

    updateLanguageMenu();
    if (focusOption) {
      const selected =
        elements.languageOptionButtons.find(
          (button) => button.dataset.language === I18n.language
        ) || elements.languageOptionButtons[0];
      selected?.focus();
    }
  }

  function focusLanguageOption(direction) {
    const buttons = elements.languageOptionButtons;
    if (!buttons.length) {
      return;
    }
    const currentIndex = buttons.indexOf(document.activeElement);
    const fallback = buttons.findIndex(
      (button) => button.dataset.language === I18n.language
    );
    const startIndex = currentIndex >= 0 ? currentIndex : Math.max(0, fallback);
    const nextIndex =
      (startIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
  }

  function switchView(view, updateHash) {
    const nextView = view === "devices" ? "devices" : "library";
    state.view = nextView;
    elements.libraryView.hidden = nextView !== "library";
    elements.devicesView.hidden = nextView !== "devices";
    elements.libraryTab.classList.toggle("is-active", nextView === "library");
    elements.devicesTab.classList.toggle("is-active", nextView === "devices");
    elements.libraryTab.setAttribute(
      "aria-current",
      nextView === "library" ? "page" : "false"
    );
    elements.devicesTab.setAttribute(
      "aria-current",
      nextView === "devices" ? "page" : "false"
    );
    if (updateHash !== false) {
      try {
        history.replaceState(null, "", `#${nextView}`);
      } catch (_error) {
        // File previews may not support history updates; keep the view local.
      }
    }
    if (nextView === "devices") {
      renderDeviceList();
    }
  }

  function renderDeviceList() {
    const devices = state.devices.length
      ? state.devices
      : state.device
        ? [{ ...state.device, current: true }]
        : [];
    elements.deviceCount.textContent = String(devices.length);
    if (elements.deviceList.querySelector("[data-device-name]:focus")) {
      return;
    }
    if (!devices.length) {
      elements.deviceList.innerHTML =
        `<p class="device-list-empty">${escapeHtml(
          I18n.t("暂无设备信息")
        )}</p>`;
      I18n.localize(elements.deviceList);
      return;
    }

    elements.deviceList.innerHTML = devices
      .map((device) => {
        const network = [
          device.localIp
            ? I18n.t("局域网 {ip}", { ip: device.localIp })
            : I18n.t("局域网未知"),
          device.publicIp
            ? I18n.t("公网 {ip}", { ip: device.publicIp })
            : I18n.t("公网未知")
        ].join(" · ");
        const meta = [
          device.browser,
          device.platform,
          network,
          device.lastSeenAt
            ? I18n.t("在线 {time}", {
                time: I18n.relativeTime(device.lastSeenAt)
              })
            : ""
        ]
          .filter(Boolean)
          .join(" · ");
        return `
          <div class="device-row${device.current ? " is-current" : ""}">
            <span class="device-row-icon">${iconMarkup("monitor-play", 16)}</span>
            <div class="device-row-copy">
              <div class="device-row-title">
                <input
                  type="text"
                  maxlength="60"
                  value="${escapeAttr(device.name || I18n.t("未命名设备"))}"
                  data-device-name="${escapeAttr(device.id)}"
                  aria-label="${escapeAttr(
                    I18n.t("编辑{name}名称", {
                      name: device.name || I18n.t("设备")
                    })
                  )}"
                >
                ${
                  device.current
                    ? `<span class="device-current-badge">${escapeHtml(
                        I18n.t("当前")
                      )}</span>`
                    : ""
                }
              </div>
              <p class="device-row-meta" title="${escapeAttr(meta)}">${escapeHtml(meta)}</p>
            </div>
          </div>
        `;
      })
      .join("");
    I18n.localize(elements.deviceList);
  }

  function renderShows() {
    const visibleShows = getVisibleShows();
    elements.showCount.textContent = String(visibleShows.length);
    if (state.pinPointerActive) {
      state.pinRenderPending = true;
      return;
    }
    const renderSignature = JSON.stringify({
      query: state.query,
      selectedShowId: state.selectedShowId,
      shows: visibleShows.map((show) => ({
        active: show.id === state.selectedShowId,
        episodeCount: getEpisodesForShow(show.id).length,
        episodeLabel: show.episodeLabel,
        hasNewEpisode: Boolean(show.hasNewEpisode),
        id: show.id,
        latestCheckedAt: Number(show.latestCheckedAt) || 0,
        latestCheckError: show.latestCheckError || "",
        latestEpisodeLabel: show.latestEpisodeLabel || "",
        latestEpisodeNumber: Number(show.latestEpisodeNumber) || 0,
        latestEpisodeStatus: show.latestEpisodeStatus || "unknown",
        maxWatchedEpisodeLabel: show.maxWatchedEpisodeLabel || "",
        maxWatchedEpisodeNumber: Number(show.maxWatchedEpisodeNumber) || 0,
        name: show.name,
        pending: state.pinPending.has(show.id),
        pinned: Boolean(show.pinned),
        pinnedAt: Number(show.pinnedAt) || 0,
        site: show.site,
        siteLabel: show.siteLabel
      })),
      total: state.shows.length
    });
    if (renderSignature === lastShowsRenderSignature) {
      return;
    }
    lastShowsRenderSignature = renderSignature;

    if (!state.shows.length) {
      elements.showsList.innerHTML = `
        <div class="detail-empty">
          <div>
            <span class="empty-icon">${iconMarkup("film", 25)}</span>
            <h2>没有追踪记录</h2>
            <p>在视频页点击扩展并开始追踪后，记录会出现在这里。</p>
          </div>
        </div>
      `;
      I18n.localize(elements.showsList);
      return;
    }

    if (!visibleShows.length) {
      elements.showsList.innerHTML = `
        <div class="episode-empty">
          <span>没有匹配的剧集</span>
        </div>
      `;
      I18n.localize(elements.showsList);
      return;
    }

    elements.showsList.innerHTML = visibleShows
      .map((show) => {
        const episodes = getEpisodesForShow(show.id);
        const active = show.id === state.selectedShowId;
        const pinPending = state.pinPending.has(show.id);
        const highestLabel = maxWatchedLabel(show);
        const latestLabel = latestEpisodeLabel(show);
        return `
          <div class="show-item${active ? " is-active" : ""}${
            show.pinned ? " is-pinned" : ""
          }">
            <button
              class="show-item-main"
              type="button"
              data-show-id="${escapeAttr(show.id)}"
              aria-pressed="${active}"
            >
              <span
                class="site-marker"
                data-site="${escapeAttr(show.site)}"
                aria-hidden="true"
              >${escapeHtml(siteInitial(show.site, show.siteLabel))}</span>
              <span class="show-copy">
                <span class="show-name">${escapeHtml(show.name)}</span>
                <span class="show-meta">
                  ${escapeHtml(
                    I18n.episodeLabel(show.episodeLabel || "集数待识别")
                  )}
                  · ${escapeHtml(
                    I18n.t("{count} 集记录", { count: episodes.length })
                  )}
                </span>
                <span class="show-meta show-meta-secondary">
                  <span class="show-meta-item">${escapeHtml(
                    I18n.t("最高 {episode}", { episode: highestLabel })
                  )}</span>
                  <span class="meta-separator">·</span>
                  <span class="show-meta-item">${escapeHtml(
                    I18n.t("最新 {episode}", { episode: latestLabel })
                  )}</span>
                  ${
                    show.hasNewEpisode
                      ? `<span
                          class="new-episode-tag"
                          aria-label="${escapeAttr(I18n.t("有新集"))}"
                          title="${escapeAttr(I18n.t("有新集"))}"
                        >${escapeHtml(I18n.t("新集"))}</span>`
                      : ""
                  }
                </span>
              </span>
              <span class="chevron">${iconMarkup("chevron-right", 16)}</span>
            </button>
            <button
              class="icon-button show-pin-button${show.pinned ? " is-pinned" : ""}${
                pinPending ? " is-pending" : ""
              }"
              type="button"
              data-pin-show-id="${escapeAttr(show.id)}"
              ${pinPending ? "disabled aria-busy=\"true\"" : ""}
              aria-label="${escapeAttr(
                pinPending
                  ? I18n.t("处理中")
                  : I18n.t(
                      show.pinned ? "取消置顶{name}" : "置顶{name}",
                      { name: show.name }
                    )
              )}"
              aria-pressed="${Boolean(show.pinned)}"
              title="${escapeAttr(
                I18n.t(
                  pinPending
                    ? "处理中"
                    : show.pinned
                      ? "取消置顶"
                      : "置顶"
                )
              )}"
            >
              ${iconMarkup(pinPending ? "loader-circle" : "pin", 16)}
            </button>
          </div>
        `;
      })
      .join("");
    I18n.localize(elements.showsList);
  }

  function episodeStatus(episode) {
    return isComplete(episode)
      ? {
          className: "is-complete",
          icon: "circle-check",
          label: I18n.t("已看完")
        }
      : {
          className: "",
          icon: "play",
          label: I18n.t("观看中")
        };
  }

  function renderEpisode(episode) {
    const progress = Core.calculateProgress(episode.position, episode.duration);
    const status = episodeStatus(episode);
    const positionLabel = Core.formatTime(episode.position);
    const durationLabel = episode.duration
      ? Core.formatTime(episode.duration)
      : I18n.t("未知");
    const openButton = episode.url
      ? `
        <button
          class="icon-button"
          type="button"
          data-open-url="${escapeAttr(episode.url)}"
          data-open-show-id="${escapeAttr(episode.showId)}"
          data-open-episode-id="${escapeAttr(episode.id)}"
          aria-label="${escapeAttr(
            I18n.t("打开{episode}", {
              episode: I18n.episodeLabel(episode.episodeLabel || "本集")
            })
          )}"
          title="${escapeAttr(I18n.t("打开观看页面"))}"
        >
          ${iconMarkup("external-link", 17)}
        </button>
      `
      : "";
    const deleteButton = `
      <button
        class="icon-button is-danger"
        type="button"
        data-delete-episode="${escapeAttr(episode.id)}"
        data-episode-show-id="${escapeAttr(episode.showId)}"
        data-episode-label="${escapeAttr(episode.episodeLabel || "本集")}"
        data-episode-storage-key="${escapeAttr(episode.storageKey || "")}"
        aria-label="${escapeAttr(
          I18n.t("删除{episode}记录", {
            episode: I18n.episodeLabel(episode.episodeLabel || "本集")
          })
        )}"
        title="${escapeAttr(I18n.t("删除分集记录"))}"
      >
        ${iconMarkup("trash-2", 16)}
      </button>
    `;
    const deviceName = episode.deviceName || I18n.t("历史记录");
    const deviceIp = episode.deviceIp || I18n.t("局域网 IP 未记录");
    const devicePublicIp = episode.devicePublicIp
      ? I18n.t("公网 {ip}", { ip: episode.devicePublicIp })
      : I18n.t("公网 IP 未记录");

    return `
      <article class="episode-row">
        <div class="episode-identity">
          <h4>${escapeHtml(
            I18n.episodeLabel(episode.episodeLabel || "集数待识别")
          )}</h4>
          <span>${escapeHtml(episode.pageTitle || "")}</span>
        </div>
        <div class="episode-progress">
          <div
            class="progress-track"
            role="progressbar"
            aria-label="${escapeAttr(
              I18n.t("{name}观看进度", {
                name: I18n.episodeLabel(episode.episodeLabel || "本集")
              })
            )}"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${progress}"
          >
            <div class="progress-fill" style="--progress:${progress / 100}"></div>
          </div>
          <div class="progress-caption">
            <span>${escapeHtml(positionLabel)} / ${escapeHtml(durationLabel)}</span>
            <span>${Math.round(progress)}%</span>
          </div>
        </div>
        <div
          class="episode-device"
          title="${escapeAttr(deviceName)} · ${escapeAttr(deviceIp)} · ${escapeAttr(devicePublicIp)}"
        >
          <strong>${escapeHtml(deviceName)}</strong>
          <span>${escapeHtml(deviceIp)}</span>
          <span>${escapeHtml(devicePublicIp)}</span>
        </div>
        <span class="episode-status ${status.className}">
          ${iconMarkup(status.icon, 13)}
          <span>${status.label}</span>
        </span>
        <span class="episode-time">${escapeHtml(formatDate(episode.updatedAt))}</span>
        <div class="episode-actions">${openButton}${deleteButton}</div>
      </article>
    `;
  }

  function renderDetail() {
    const show = state.shows.find((item) => item.id === state.selectedShowId);
    if (!show) {
      elements.detailPanel.innerHTML = `
        <div class="detail-empty">
          <div>
            <span class="empty-icon">${iconMarkup("layout-list", 27)}</span>
            <h2>选择一部剧集</h2>
            <p>从左侧选择剧集，查看每一集的观看时长和播放位置。</p>
          </div>
        </div>
      `;
      document.title = I18n.t("观看记录 - 剧迹");
      I18n.localize(elements.detailPanel);
      return;
    }

    const allEpisodes = getEpisodesForShow(show.id);
    const filteredEpisodes = allEpisodes.filter((episode) => {
      if (state.filter === "complete") {
        return isComplete(episode);
      }
      if (state.filter === "watching") {
        return !isComplete(episode);
      }
      return true;
    });
    const completeCount = allEpisodes.filter(isComplete).length;
    const totalPosition = allEpisodes.reduce(
      (sum, episode) => sum + Math.max(0, episode.position || 0),
      0
    );
    const highestLabel = maxWatchedLabel(show);
    const latestLabel = latestEpisodeLabel(show);
    const latestCheckError = localizeLatestCheckError(show.latestCheckError);
    const latestCheckText = latestCheckError
      ? I18n.t("检查失败")
      : show.latestCheckedAt
        ? I18n.t("最近检查 {time}", {
            time: I18n.relativeTime(show.latestCheckedAt)
          })
        : I18n.t("尚未检查网站更新");

    elements.detailPanel.innerHTML = `
      <header class="detail-header">
        <div class="detail-title-row">
          <div class="detail-title-copy">
            <p class="eyebrow">${escapeHtml(
              I18n.siteLabel(show.siteLabel || "网页视频")
            )}</p>
            <h2>${escapeHtml(show.name)}</h2>
            <p class="detail-subtitle">
              ${escapeHtml(
                I18n.episodeLabel(show.episodeLabel || "集数待识别")
              )}
              · ${escapeHtml(
                I18n.t("最近观看 {time}", {
                  time: I18n.relativeTime(show.updatedAt)
                })
              )}
            </p>
          </div>
          <div class="detail-actions">
            <button
              class="button button-primary"
              type="button"
              data-resume-show-id="${escapeAttr(show.id)}"
              ${
                state.resumePendingShowId === show.id
                  ? "disabled aria-busy=\"true\""
                  : ""
              }
            >
              ${iconMarkup("play", 16)}
              <span>${state.resumePendingShowId === show.id ? "正在续播" : "继续观看"}</span>
            </button>
            <button
              class="button button-danger-outline"
              type="button"
              data-delete-show="${escapeAttr(show.id)}"
              data-show-label="${escapeAttr(show.name)}"
            >
              ${iconMarkup("trash-2", 16)}
              <span>删除剧集</span>
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <article class="stat-card" data-stat="max-watched">
            <p class="stat-label">最高观看</p>
            <p class="stat-value stat-value-episode">${escapeHtml(highestLabel)}</p>
          </article>
          <article class="stat-card${show.hasNewEpisode ? " is-update" : ""}" data-stat="latest-episode">
            <p class="stat-label">网站最新</p>
            <p class="stat-value stat-value-episode${show.hasNewEpisode ? " is-accent" : ""}">${escapeHtml(latestLabel)}</p>
            ${
              show.hasNewEpisode
                ? `<span class="stat-update">${iconMarkup("circle-check", 12)}<span>有新集</span></span>`
                : ""
            }
          </article>
          <article class="stat-card" data-stat="episode-count">
            <p class="stat-label">剧集记录</p>
            <p class="stat-value">${allEpisodes.length}</p>
          </article>
          <article class="stat-card" data-stat="completed-count">
            <p class="stat-label">已看完</p>
            <p class="stat-value is-accent">${completeCount}</p>
          </article>
          <article class="stat-card" data-stat="watch-time">
            <p class="stat-label">累计记录时长</p>
            <p class="stat-value">${escapeHtml(formatTotalDuration(totalPosition))}</p>
          </article>
        </div>

        <p
          class="latest-check${latestCheckError ? " is-error" : show.latestCheckedAt ? " is-ok" : ""}"
          title="${escapeAttr(I18n.t("浏览器运行时每小时自动检查"))}"
        >
          ${iconMarkup(latestCheckError ? "x" : "refresh-cw", 13)}
          <span>${escapeHtml(latestCheckText)}</span>
          ${
            latestCheckError
              ? `<span class="latest-check-detail">${escapeHtml(latestCheckError)}</span>`
              : ""
          }
        </p>
      </header>

      <div class="episode-toolbar">
        <h3>分集记录</h3>
        <div class="segmented" role="group" aria-label="筛选分集记录">
          <button class="segment${state.filter === "all" ? " is-active" : ""}" type="button" data-filter="all" aria-pressed="${state.filter === "all"}">全部</button>
          <button class="segment${state.filter === "watching" ? " is-active" : ""}" type="button" data-filter="watching" aria-pressed="${state.filter === "watching"}">观看中</button>
          <button class="segment${state.filter === "complete" ? " is-active" : ""}" type="button" data-filter="complete" aria-pressed="${state.filter === "complete"}">已看完</button>
        </div>
      </div>

      <div class="episode-list">
        ${
          filteredEpisodes.length
            ? filteredEpisodes.map(renderEpisode).join("")
            : `
              <div class="episode-empty">
                <span>这个筛选条件下没有分集记录</span>
              </div>
            `
        }
      </div>
    `;

    document.title = I18n.t("{show} - 剧迹", { show: show.name });
    I18n.localize(elements.detailPanel);
  }

  function render() {
    updateSyncState();
    updateNetworkState();
    renderDeviceList();
    renderShows();
    renderDetail();
    I18n.localize(document);
  }

  async function loadLibrary() {
    elements.refreshButton.disabled = true;
    try {
      if (globalThis.VideoTrackerDeviceProfile) {
        state.networkInfoEnabled =
          await globalThis.VideoTrackerDeviceProfile.getNetworkInfoEnabled();
        elements.networkInfoToggle.checked = state.networkInfoEnabled;
        state.device = await globalThis.VideoTrackerDeviceProfile.ensure();
      }
      const response = await sendRuntime({ type: "VT_GET_LIBRARY_STATE" });
      if (!response.ok) {
        throw new Error(response.error || I18n.t("无法读取观看记录"));
      }

      state.shows = applyPendingPinState(
        Array.isArray(response.shows) ? response.shows : []
      );
      state.episodes = Array.isArray(response.episodes) ? response.episodes : [];
      state.syncIssue = response.syncIssue || null;
      state.syncState = response.syncState || null;
      state.device = response.device || state.device;
      state.devices = Array.isArray(response.devices) ? response.devices : [];

      const selectedStillExists = state.shows.some(
        (show) => show.id === state.selectedShowId
      );
      if (!selectedStillExists) {
        state.selectedShowId = state.shows[0]?.id || null;
      }
      render();
    } catch (error) {
      showToast(error.message || I18n.t("观看记录加载失败"), true);
      elements.detailPanel.innerHTML = `
        <div class="detail-empty">
          <div>
            <span class="empty-icon">${iconMarkup("film", 25)}</span>
            <h2>记录加载失败</h2>
            <p>${escapeHtml(error.message || "请稍后重试")}</p>
          </div>
        </div>
      `;
      I18n.localize(elements.detailPanel);
    } finally {
      elements.refreshButton.disabled = false;
    }
  }

  async function resumeShow(showId, episodeId) {
    const show = state.shows.find((item) => item.id === showId);
    const episode = episodeId
      ? state.episodes.find((item) => item.id === episodeId)
      : null;
    if (!show || state.resumePendingShowId) {
      return;
    }
    if (episodeId && !episode) {
      showToast(I18n.t("追踪记录不存在"), true);
      return;
    }

    state.resumePendingShowId = showId;
    const button = episodeId
      ? document.querySelector(
          `[data-open-episode-id="${CSS.escape(episodeId)}"]`
        )
      : document.querySelector(
          `[data-resume-show-id="${CSS.escape(showId)}"]`
        );
    const buttonLabel = button && button.querySelector("span");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    if (buttonLabel) {
      buttonLabel.textContent = I18n.t("正在续播");
    }
    showToast(I18n.t("正在恢复播放位置"));

    try {
      const message = {
        id: showId,
        type: "VT_RESUME_SHOW"
      };
      if (episodeId) {
        message.episodeId = episodeId;
      }
      const response = await sendRuntime(message);
      if (!response.ok) {
        throw new Error(response.error || I18n.t("无法打开观看页面"));
      }

      const episode = I18n.episodeLabel(
        response.episodeLabel || show.episodeLabel || "本集"
      );
      if (response.resumed) {
        showToast(
          I18n.t("已从 {time} 继续播放{episode}", {
            episode,
            time: Core.formatTime(response.currentTime)
          })
        );
      } else if (Number(response.requestedPosition) > 0) {
        showToast(
          I18n.t("{episode}已打开，网站暂不支持自动定位", {
            episode
          })
        );
      } else if (response.allComplete) {
        showToast(I18n.t("这部剧已经看完，已打开最近一集"));
      } else {
        showToast(I18n.t("已打开{episode}", { episode }));
      }
    } catch (error) {
      showToast(error.message || I18n.t("无法打开观看页面"), true);
    } finally {
      state.resumePendingShowId = null;
      if (button && button.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
      if (buttonLabel && buttonLabel.isConnected) {
        buttonLabel.textContent = I18n.t("继续观看");
      }
    }
  }

  async function exportBackup() {
    elements.exportButton.disabled = true;
    try {
      const response = await sendRuntime({ type: "VT_EXPORT_BACKUP" });
      const backup = response.ok && response.backup
        ? response.backup
        : await readBackupDirectly();
      if (!backup) {
        throw new Error(response.error || I18n.t("无法导出备份"));
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      anchor.href = url;
      anchor.download = `video-tracker-backup-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(
        I18n.t("已导出 {shows} 部剧、{episodes} 集记录", {
          episodes: backup.episodes.length,
          shows: backup.shows.length
        })
      );
    } catch (error) {
      showToast(error.message || I18n.t("导出失败"), true);
    } finally {
      elements.exportButton.disabled = false;
    }
  }

  function readStorageArea(area) {
    return new Promise((resolve) => {
      area.get(null, (result) => resolve(result || {}));
    });
  }

  async function readBackupDirectly() {
    const [syncData, localData] = await Promise.all([
      readStorageArea(chrome.storage.sync),
      readStorageArea(chrome.storage.local)
    ]);
    const showsById = new Map();
    const episodesById = new Map();
    for (const [key, value] of Object.entries(syncData)) {
      if (key.startsWith("vt.show.") && value && value.id) {
        showsById.set(value.id, value);
      } else if (key.startsWith("vt.episode.") && value && value.id) {
        episodesById.set(value.id, value);
      }
    }
    for (const [key, value] of Object.entries(localData)) {
      if (key.startsWith("vt.local.show.") && value && value.id) {
        const current = showsById.get(value.id);
        if (!current || Number(value.updatedAt) > Number(current.updatedAt)) {
          showsById.set(value.id, value);
        }
      } else if (key.startsWith("vt.local.episode.") && value && value.id) {
        const current = episodesById.get(value.id);
        if (!current || Number(value.updatedAt) > Number(current.updatedAt)) {
          episodesById.set(value.id, value);
        }
      }
    }
    if (!showsById.size && !episodesById.size) {
      return null;
    }
    return {
      episodes: Array.from(episodesById.values()),
      exportedAt: Date.now(),
      shows: Array.from(showsById.values()),
      version: 1
    };
  }

  async function importBackupFile(file) {
    if (!file) {
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(I18n.t("备份文件过大"), true);
      return;
    }

    try {
      const backup = JSON.parse(await file.text());
      const shouldImport = confirm(
        I18n.t(
          "导入会合并备份中的剧集和分集记录，较新的记录优先。继续吗？"
        )
      );
      if (!shouldImport) {
        return;
      }
      const response = await sendRuntime({
        backup,
        type: "VT_IMPORT_BACKUP"
      });
      if (!response.ok) {
        throw new Error(response.error || I18n.t("导入失败"));
      }
      await loadLibrary();
      showToast(
        I18n.t("已合并 {shows} 部剧、{episodes} 集记录", {
          episodes: response.episodes,
          shows: response.shows
        })
      );
    } catch (error) {
      showToast(error.message || I18n.t("备份文件无法读取"), true);
    } finally {
      elements.importFile.value = "";
    }
  }

  function openDeleteDialog(config) {
    state.pendingDelete = config;
    elements.deleteError.hidden = true;
    elements.deleteError.textContent = "";
    elements.deleteMessage.textContent =
      config.type === "show"
        ? I18n.t("确定删除“{name}”及其所有分集记录？此操作不可撤销。", {
            name: config.label
          })
        : I18n.t(
            "确定删除“{name}”这一集的记录？如果它是该剧最后一条记录，剧集条目也会一并删除。",
            { name: I18n.episodeLabel(config.label) }
          );
    elements.deleteDialog.showModal();
    elements.cancelDeleteSecondary.focus();
  }

  function closeDeleteDialog() {
    elements.deleteDialog.close();
    state.pendingDelete = null;
  }

  async function confirmDelete(event) {
    event.preventDefault();
    if (!state.pendingDelete) {
      return;
    }

    const pending = state.pendingDelete;
    elements.confirmDeleteButton.disabled = true;
    elements.deleteError.hidden = true;
    const response =
      pending.type === "show"
        ? await sendRuntime({
            id: pending.showId,
            type: "VT_DELETE_SHOW"
          })
        : await sendRuntime({
            episodeId: pending.episodeId,
            episodeLabel: pending.label,
            showId: pending.showId,
            storageKey: pending.storageKey,
            type: "VT_DELETE_EPISODE"
          });

    if (!response.ok) {
      elements.confirmDeleteButton.disabled = false;
      elements.deleteError.textContent =
        response.error || I18n.t("删除失败");
      elements.deleteError.hidden = false;
      return;
    }

    elements.confirmDeleteButton.disabled = false;
    closeDeleteDialog();
    await loadLibrary();
    showToast(
      I18n.t(
        pending.type === "show"
          ? "剧集及分集记录已删除"
          : "分集记录已删除"
      )
    );
  }

  async function toggleShowPin(showId) {
    if (state.pinPending.has(showId)) {
      return;
    }
    const show = state.shows.find((item) => item.id === showId);
    if (!show) {
      return;
    }

    const previousPinState = {
      pinned: Boolean(show.pinned),
      pinnedAt: Number(show.pinnedAt) || 0,
      updatedAt: Number(show.updatedAt) || 0
    };
    const pinned = !show.pinned;
    const optimisticAt = Date.now();
    state.pinPending.add(showId);
    state.shows = sortShows(
      state.shows.map((item) =>
        item.id === showId
          ? {
              ...item,
              pinned,
              pinnedAt: pinned ? optimisticAt : 0,
              updatedAt: optimisticAt
            }
          : item
      )
    );
    renderShows();

    const response = await sendRuntime({
      id: showId,
      pinned,
      type: "VT_SET_SHOW_PINNED"
    });
    state.pinPending.delete(showId);
    if (!response.ok) {
      state.shows = sortShows(
        state.shows.map((item) =>
          item.id === showId ? { ...item, ...previousPinState } : item
        )
      );
      renderShows();
      showToast(response.error || I18n.t("置顶失败"), true);
      return;
    }

    if (response.record) {
      state.shows = sortShows(
        state.shows.map((item) =>
          item.id === showId ? { ...item, ...response.record } : item
        )
      );
    }
    renderShows();
    showToast(
      I18n.t(
        pinned ? "已置顶{name}" : "已取消置顶{name}",
        { name: show.name }
      )
    );
  }

  function closestActionTarget(event, selector) {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const target of path) {
      if (target && typeof target.matches === "function" && target.matches(selector)) {
        return target;
      }
    }
    return event.target && typeof event.target.closest === "function"
      ? event.target.closest(selector)
      : null;
  }

  document.addEventListener(
    "click",
    (event) => {
      const guard = state.actionPointerGuard;
      if (!guard || Number(event.detail) === 0) {
        return;
      }
      state.actionPointerGuard = null;
      if (Date.now() - guard.at > 1500) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || event.isPrimary === false) {
        return;
      }
      const resumeButton = closestActionTarget(event, "[data-resume-show-id]");
      const openButton = closestActionTarget(event, "[data-open-url]");
      if (!resumeButton && !openButton) {
        return;
      }

      state.actionPointerGuard = {
        at: Date.now(),
        key: resumeButton
          ? `resume:${resumeButton.dataset.resumeShowId}`
          : `open:${openButton.dataset.openEpisodeId}`
      };
      event.preventDefault();
      event.stopPropagation();
      if (resumeButton) {
        void resumeShow(resumeButton.dataset.resumeShowId);
      } else {
        void resumeShow(
          openButton.dataset.openShowId,
          openButton.dataset.openEpisodeId
        );
      }
    },
    true
  );

  const clearPointerActionGuard = () => {
    const guard = state.actionPointerGuard;
    if (!guard) {
      return;
    }
    setTimeout(() => {
      if (state.actionPointerGuard === guard) {
        state.actionPointerGuard = null;
      }
    }, 0);
  };
  document.addEventListener("pointerup", clearPointerActionGuard, true);
  document.addEventListener("pointercancel", clearPointerActionGuard, true);

  document.addEventListener("click", (event) => {
    const resumeButton = closestActionTarget(event, "[data-resume-show-id]");
    if (resumeButton) {
      event.preventDefault();
      void resumeShow(resumeButton.dataset.resumeShowId);
      return;
    }

    const openButton = closestActionTarget(event, "[data-open-url]");
    if (openButton) {
      event.preventDefault();
      void resumeShow(
        openButton.dataset.openShowId,
        openButton.dataset.openEpisodeId
      );
      return;
    }

    const deleteShowButton = closestActionTarget(event, "[data-delete-show]");
    if (deleteShowButton) {
      event.preventDefault();
      openDeleteDialog({
        label: deleteShowButton.dataset.showLabel,
        showId: deleteShowButton.dataset.deleteShow,
        type: "show"
      });
      return;
    }

    const deleteEpisodeButton = closestActionTarget(
      event,
      "[data-delete-episode]"
    );
    if (deleteEpisodeButton) {
      event.preventDefault();
      openDeleteDialog({
        episodeId: deleteEpisodeButton.dataset.deleteEpisode,
        label: deleteEpisodeButton.dataset.episodeLabel,
        showId: deleteEpisodeButton.dataset.episodeShowId,
        storageKey: deleteEpisodeButton.dataset.episodeStorageKey,
        type: "episode"
      });
      return;
    }

    const pinShowButton = closestActionTarget(event, "[data-pin-show-id]");
    if (pinShowButton) {
      event.preventDefault();
      void toggleShowPin(pinShowButton.dataset.pinShowId);
      return;
    }

    const showButton = closestActionTarget(event, "[data-show-id]");
    if (showButton) {
      event.preventDefault();
      state.selectedShowId = showButton.dataset.showId;
      renderShows();
      renderDetail();
      return;
    }

    const filterButton = closestActionTarget(event, "[data-filter]");
    if (filterButton) {
      event.preventDefault();
      state.filter = filterButton.dataset.filter;
      renderDetail();
    }
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target.closest?.("[data-pin-show-id]")) {
        state.pinPointerActive = true;
      }
    },
    true
  );
  const finishPinPointer = () => {
    if (!state.pinPointerActive) {
      return;
    }
    state.pinPointerActive = false;
    if (state.pinRenderPending) {
      state.pinRenderPending = false;
      setTimeout(renderShows, 0);
    }
  };
  document.addEventListener("pointerup", finishPinPointer, true);
  document.addEventListener("pointercancel", finishPinPointer, true);
  window.addEventListener("blur", finishPinPointer);

  elements.showSearch.addEventListener("input", () => {
    state.query = elements.showSearch.value;
    renderShows();
    if (!state.shows.some((show) => show.id === state.selectedShowId)) {
      state.selectedShowId = getVisibleShows()[0]?.id || null;
      renderDetail();
    }
  });

  async function runManualSync() {
    elements.refreshButton.disabled = true;
    elements.syncNowButton.disabled = true;
    try {
      await loadLibrary();
      showToast(
        I18n.t(
          state.syncState && state.syncState.status === "synced"
            ? "本地与云端已对齐"
            : "同步未完成，请检查浏览器同步设置"
        ),
        Boolean(state.syncState && state.syncState.status === "error")
      );
    } finally {
      elements.refreshButton.disabled = false;
      elements.syncNowButton.disabled = false;
    }
  }

  elements.refreshButton.addEventListener("click", () => {
    void runManualSync();
  });

  elements.syncNowButton.addEventListener("click", () => {
    void runManualSync();
  });

  elements.exportButton.addEventListener("click", () => {
    void exportBackup();
  });

  elements.importButton.addEventListener("click", () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener("change", () => {
    void importBackupFile(elements.importFile.files[0]);
  });

  elements.deleteForm.addEventListener("submit", (event) => {
    void confirmDelete(event);
  });

  elements.cancelDeleteButton.addEventListener("click", closeDeleteDialog);
  elements.cancelDeleteSecondary.addEventListener("click", closeDeleteDialog);
  elements.deleteDialog.addEventListener("click", (event) => {
    if (event.target === elements.deleteDialog) {
      closeDeleteDialog();
    }
  });

  elements.deviceList.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-device-name]");
    if (!input) {
      return;
    }
    const response = await sendRuntime({
      deviceId: input.dataset.deviceName,
      name: input.value,
      type: "VT_RENAME_DEVICE"
    });
    if (!response.ok) {
      showToast(response.error || I18n.t("设备名称更新失败"), true);
      return;
    }
    state.device = response.device || state.device;
    state.devices = Array.isArray(response.devices)
      ? response.devices
      : state.devices;
    renderDeviceList();
    showToast(I18n.t("设备名称已更新"));
  });

  elements.deviceList.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-device-name]")) {
      event.preventDefault();
      event.target.blur();
    }
  });

  elements.networkInfoToggle.addEventListener("change", async () => {
    if (!globalThis.VideoTrackerDeviceProfile) {
      return;
    }
    elements.networkInfoToggle.disabled = true;
    try {
      const enabled = elements.networkInfoToggle.checked;
      state.device =
        await globalThis.VideoTrackerDeviceProfile.setNetworkInfoEnabled(
          enabled
        );
      state.networkInfoEnabled = enabled;
      updateNetworkState();
      await sendRuntime({ type: "VT_SYNC_NOW" });
      await loadLibrary();
      showToast(
        I18n.t(
          enabled ? "网络信息已开启" : "网络信息已关闭"
        )
      );
    } finally {
      elements.networkInfoToggle.disabled = false;
    }
  });

  elements.libraryTab.addEventListener("click", () => {
    switchView("library");
  });
  elements.devicesTab.addEventListener("click", () => {
    switchView("devices");
  });
  window.addEventListener("hashchange", () => {
    switchView(location.hash === "#devices" ? "devices" : "library", false);
  });
  updateLanguageMenu();
  elements.languageButton.addEventListener("click", () => {
    setLanguageMenuOpen(!state.languageMenuOpen, false);
  });
  elements.languageButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.languageMenuOpen) {
      event.preventDefault();
      setLanguageMenuOpen(false, false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    setLanguageMenuOpen(true, true);
  });
  for (const button of elements.languageOptionButtons) {
    button.addEventListener("click", () => {
      const language = button.dataset.language;
      setLanguageMenuOpen(false, false);
      if (language !== I18n.language) {
        I18n.setLanguage(language);
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusLanguageOption(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        elements.languageOptionButtons[
          event.key === "Home"
            ? 0
            : elements.languageOptionButtons.length - 1
        ]?.focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setLanguageMenuOpen(false, false);
        elements.languageButton.focus();
      } else if (event.key === "Tab") {
        setLanguageMenuOpen(false, false);
      }
    });
  }
  elements.languageMenu.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!elements.languageMenu.contains(document.activeElement)) {
        setLanguageMenuOpen(false, false);
      }
    }, 0);
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      state.languageMenuOpen &&
      !elements.languageMenu.contains(event.target)
    ) {
      setLanguageMenuOpen(false, false);
    }
  });

  if (chrome.storage && chrome.storage.onChanged) {
    let refreshTimer = null;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const relevant = Object.keys(changes || {}).some(
        (key) =>
          key.startsWith("vt.show.") ||
          key.startsWith("vt.episode.") ||
          key.startsWith("vt.device.") ||
          key.startsWith("vt.latest.") ||
          key.startsWith("vt.local.") ||
          key === "vt.deviceProfile.v1" ||
          key === "vt.syncIssue"
      );
      if (!relevant) {
        return;
      }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadLibrary();
      }, 220);
    });
  }

  hydrateIcons();
  I18n.localize(document);
  switchView(location.hash === "#devices" ? "devices" : "library", false);
  void loadLibrary();
})();
