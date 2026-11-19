(function initializeLibraryPage() {
  "use strict";

  const Core = globalThis.VideoTrackerCore;
  const I18n = globalThis.VideoTrackerI18n;
  const iconPaths = globalThis.VideoTrackerIconPaths || {};
  const state = {
    device: null,
    devices: [],
    episodes: [],
    filter: "all",
    networkInfoEnabled: false,
    pendingDelete: null,
    query: "",
    selectedShowId: null,
    shows: [],
    syncIssue: null,
    syncState: null,
    toastTimer: null,
    view: "library"
  };

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
    languageButtons: Array.from(document.querySelectorAll("[data-language]")),
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

  function isComplete(episode) {
    return (
      Boolean(episode.completed) ||
      Core.calculateProgress(episode.position, episode.duration) >= 95
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

  function getVisibleShows() {
    const query = Core.normalizeText(state.query).toLocaleLowerCase();
    return state.shows.filter((show) => showMatchesQuery(show, query));
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
        return `
          <button
            class="show-item${active ? " is-active" : ""}"
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
            </span>
            <span class="chevron">${iconMarkup("chevron-right", 16)}</span>
          </button>
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
            <button class="button button-primary" type="button" data-open-url="${escapeAttr(show.url)}">
              ${iconMarkup("play", 16)}
              <span>继续观看</span>
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
          <article class="stat-card">
            <p class="stat-label">剧集记录</p>
            <p class="stat-value">${allEpisodes.length}</p>
          </article>
          <article class="stat-card">
            <p class="stat-label">已看完</p>
            <p class="stat-value is-accent">${completeCount}</p>
          </article>
          <article class="stat-card">
            <p class="stat-label">累计记录时长</p>
            <p class="stat-value">${escapeHtml(formatTotalDuration(totalPosition))}</p>
          </article>
        </div>
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

      state.shows = Array.isArray(response.shows) ? response.shows : [];
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

  async function openUrl(url) {
    if (!url) {
      showToast(I18n.t("这条记录没有可打开的页面"), true);
      return;
    }
    await new Promise((resolve) => {
      chrome.tabs.create({ url }, () => resolve());
    });
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

  document.addEventListener("click", (event) => {
    const deleteShowButton = event.target.closest("[data-delete-show]");
    if (deleteShowButton) {
      openDeleteDialog({
        label: deleteShowButton.dataset.showLabel,
        showId: deleteShowButton.dataset.deleteShow,
        type: "show"
      });
      return;
    }

    const deleteEpisodeButton = event.target.closest("[data-delete-episode]");
    if (deleteEpisodeButton) {
      openDeleteDialog({
        episodeId: deleteEpisodeButton.dataset.deleteEpisode,
        label: deleteEpisodeButton.dataset.episodeLabel,
        showId: deleteEpisodeButton.dataset.episodeShowId,
        storageKey: deleteEpisodeButton.dataset.episodeStorageKey,
        type: "episode"
      });
      return;
    }

    const showButton = event.target.closest("[data-show-id]");
    if (showButton) {
      state.selectedShowId = showButton.dataset.showId;
      renderShows();
      renderDetail();
      return;
    }

    const filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      state.filter = filterButton.dataset.filter;
      renderDetail();
      return;
    }

    const openButton = event.target.closest("[data-open-url]");
    if (openButton) {
      void openUrl(openButton.dataset.openUrl);
    }
  });

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
  for (const button of elements.languageButtons) {
    button.classList.toggle(
      "is-active",
      button.dataset.language === I18n.language
    );
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === I18n.language)
    );
    button.addEventListener("click", () => {
      I18n.setLanguage(button.dataset.language);
    });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    let refreshTimer = null;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const relevant = Object.keys(changes || {}).some(
        (key) =>
          key.startsWith("vt.show.") ||
          key.startsWith("vt.episode.") ||
          key.startsWith("vt.device.") ||
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
