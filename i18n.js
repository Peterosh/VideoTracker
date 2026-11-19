(function attachI18n(root) {
  "use strict";

  const LANGUAGE_STORAGE_KEY = "vt.uiLanguage";
  let storedLanguage = "";
  try {
    if (typeof localStorage !== "undefined") {
      storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "";
    }
  } catch (_error) {
    storedLanguage = "";
  }
  const uiLanguage =
    (root.chrome &&
      root.chrome.i18n &&
      root.chrome.i18n.getUILanguage &&
      root.chrome.i18n.getUILanguage()) ||
    "zh-CN";
  const language =
    storedLanguage === "zh" || storedLanguage === "en"
      ? storedLanguage
      : /^zh\b/i.test(uiLanguage)
        ? "zh"
        : "en";
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const english = {
    "剧迹": "VideoTracker",
    "剧迹 VideoTracker": "VideoTracker",
    "剧迹 - VideoTracker": "VideoTracker - Episode Progress Tracker",
    "观看记录 - 剧迹": "Watch History - VideoTracker",
    "浏览器同步": "Browser sync",
    "记录通过浏览器账户同步": "Synced through your browser account",
    "使用当前浏览器账户同步": "Sync with the current browser account",
    "刷新": "Refresh",
    "刷新观看记录": "Refresh watch history",
    "打开观看记录管理": "Open watch history",
    "管理观看记录": "Manage watch history",
    "当前视频": "Current video",
    "扩展页面": "Extension pages",
    "正在读取视频信息": "Loading video information",
    "观看记录": "Watch history",
    "追踪列表": "Tracked shows",
    "0 部": "0 shows",
    "正在读取追踪列表": "Loading tracked shows",
    "编辑记录": "Edit record",
    "关闭编辑窗口": "Close edit dialog",
    "关闭": "Close",
    "剧名": "Show title",
    "集数": "Episode",
    "待识别": "Not detected",
    "自动识别集数": "Detect episode automatically",
    "跟随视频页面更新": "Follow updates from the video page",
    "取消": "Cancel",
    "保存": "Save",
    "删除记录": "Delete record",
    "关闭删除窗口": "Close delete dialog",
    "删除": "Delete",
    "处理中": "Working",
    "已播完": "Finished",
    "已暂停": "Paused",
    "播放中": "Playing",
    "广告中，暂未记录": "Advertisement detected; progress is paused",
    "本集观看进度": "Episode watch progress",
    "没有检测到视频": "No video detected",
    "播放器暂时无法读取，请稍后重新检测。": "The player is temporarily unavailable. Try again shortly.",
    "打开视频播放页后重新检测。": "Open a video page and try again.",
    "重新检测": "Detect again",
    "视频正在加载": "Video is loading",
    "等待播放器返回时长后即可记录进度。": "Progress can be recorded after the player reports a duration.",
    "集数待识别": "Episode not detected",
    "编辑": "Edit",
    "追踪中": "Tracking",
    "已看": "Watched",
    "停止追踪": "Stop tracking",
    "改为追踪当前视频": "Track this video instead",
    "开始追踪": "Start tracking",
    "还没有追踪记录": "No tracked records yet",
    "当前": "Current",
    "打开上次观看页面": "Open the last watch page",
    "看到": "At",
    "无法读取追踪记录": "Unable to load tracked records",
    "扩展初始化失败": "Extension initialization failed",
    "请填写剧名": "Enter a show title",
    "正在开始": "Starting",
    "无法开始追踪": "Unable to start tracking",
    "已记录，当前保存在本机": "Saved locally for now",
    "已开始追踪": "Tracking started",
    "检测到广告，正片开始后自动记录": "Advertisement detected. Tracking will resume when content starts.",
    "正在停止": "Stopping",
    "无法停止追踪": "Unable to stop tracking",
    "已停止追踪，记录已保留": "Tracking stopped; the record was kept",
    "这条记录没有可打开的页面": "This record has no page to open",
    "无法打开观看页面": "Unable to open the watch page",
    "保存中": "Saving",
    "保存失败": "Save failed",
    "已保存到本机": "Saved locally",
    "记录已更新": "Record updated",
    "删除中": "Deleting",
    "删除失败": "Delete failed",
    "记录已删除": "Record deleted",
    "当前页面无法读取视频": "Unable to read video on this page",
    "本地云端已对齐": "Local and cloud aligned",
    "同步失败": "Sync failed",
    "同步中": "Syncing",
    "同步完成": "Sync complete",
    "无法访问浏览器同步存储": "Unable to access browser sync storage",
    "本地未同步": "Local changes pending",
    "本地与云端未对齐": "Local and cloud are not aligned",
    "本地存储与浏览器同步存储已对齐": "Local storage and browser sync storage are aligned",
    "正在等待同步": "Waiting for sync",
    "本地存储和云端存储已同步": "Local and cloud storage are aligned",
    "浏览器同步存储不可用": "Browser sync storage is unavailable",
    "本地记录尚未同步到云端": "Local records have not been synced to the cloud",
    "本地存储与云端存储已对齐": "Local and cloud storage are aligned",
    "观看记录": "Watch history",
    "视频追踪": "Video tracker",
    "资料库": "Library",
    "追踪剧集": "Tracked shows",
    "搜索剧名或集数": "Search shows or episodes",
    "搜索追踪列表": "Search tracked shows",
    "没有匹配记录": "No matching records",
    "本地与云端": "Local and cloud",
    "等待检查": "Waiting for check",
    "未同步": "Not synced",
    "已同步": "Synced",
    "尚未执行同步检查。": "No sync check has run yet.",
    "立即同步": "Sync now",
    "尚未同步": "Not synced yet",
    "扩展 ID": "Extension ID",
    "设备列表": "Devices",
    "设备管理": "Device management",
    "管理当前设备和已同步设备的显示名称。": "Manage display names for this and synchronized devices.",
    "管理页面": "Management pages",
    "语言": "Language",
    "正在读取设备...": "Loading devices...",
    "导出备份": "Export backup",
    "导入备份": "Import backup",
    "选择一部剧集": "Select a show",
    "从左侧选择剧集，查看每一集的观看时长和播放位置。": "Select a show to view watch time and playback position for each episode.",
    "全部": "All",
    "观看中": "Watching",
    "已看完": "Completed",
    "分集记录": "Episode history",
    "剧集记录": "Episodes",
    "累计记录时长": "Recorded watch time",
    "继续观看": "Continue watching",
    "删除剧集": "Delete show",
    "确认操作": "Confirm action",
    "最近观看": "Last watched",
    "未知": "Unknown",
    "已同步记录": "Synced records",
    "本地待上传": "Pending local records",
    "这个筛选条件下没有分集记录": "No episode records match this filter",
    "没有追踪记录": "No tracked records",
    "在视频页点击扩展并开始追踪后，记录会出现在这里。": "Start tracking from a video page to see records here.",
    "没有匹配的剧集": "No matching shows",
    "记录加载失败": "Failed to load records",
    "请稍后重试": "Try again later",
    "无法读取观看记录": "Unable to load watch history",
    "观看记录加载失败": "Failed to load watch history",
    "无法导出备份": "Unable to export backup",
    "导出失败": "Export failed",
    "备份文件过大": "Backup file is too large",
    "导入会合并备份中的剧集和分集记录，较新的记录优先。继续吗？": "Import will merge shows and episodes from the backup. Newer records take priority. Continue?",
    "导入失败": "Import failed",
    "备份文件无法读取": "Unable to read the backup file",
    "设备名称更新失败": "Failed to update device name",
    "设备名称已更新": "Device name updated",
    "删除失败": "Delete failed",
    "剧集及分集记录已删除": "Show and episode records deleted",
    "分集记录已删除": "Episode record deleted",
    "本地与云端已对齐": "Local and cloud are aligned",
    "同步未完成，请检查浏览器同步设置": "Sync did not finish. Check browser sync settings.",
    "暂无设备信息": "No device information",
    "暂无记录": "No record",
    "未命名设备": "Unnamed device",
    "设备": "device",
    "局域网未知": "LAN IP unknown",
    "公网未知": "Public IP unknown",
    "当前设备": "Current device",
    "历史记录": "Historical record",
    "局域网 IP 未记录": "LAN IP not recorded",
    "公网 IP 未记录": "Public IP not recorded",
    "打开观看页面": "Open watch page",
    "删除分集记录": "Delete episode record",
    "本集": "this episode",
    "正在同步": "Syncing",
    "网络信息": "Network information",
    "允许获取并同步局域网和公网 IP": "Allow collecting and syncing LAN and public IP addresses",
    "网络信息已开启": "Network information enabled",
    "网络信息已关闭": "Network information disabled",
    "未知平台": "Unknown platform",
    "未命名剧集": "Untitled show",
    "网页视频": "Web video",
    "哔哩哔哩": "Bilibili",
    "腾讯视频": "Tencent Video",
    "爱奇艺": "iQIYI",
    "优酷": "Youku",
    "芒果TV": "Mango TV",
    "当前页面": "Current page",
    "标签页已关闭": "The tab was closed",
    "当前页面不支持视频检测": "Video detection is not supported on this page",
    "没有找到当前标签页": "Current tab was not found",
    "当前页面还没有可记录的播放进度": "This page has no recordable playback progress yet",
    "追踪记录不存在": "Tracking record does not exist",
    "无效的剧集记录": "Invalid episode record",
    "设备名称无效": "Invalid device name",
    "设备记录不存在": "Device record does not exist",
    "备份文件格式无效": "Invalid backup file format",
    "无法读取视频：{error}": "Unable to read video: {error}",
    "有 {pending} 条本地记录尚未上传": "{pending} local records are not uploaded yet",
    "云端 {shows} 部剧、{episodes} 集记录；本地待上传 {pending} 条。": "Cloud: {shows} shows and {episodes} episodes; {pending} local records pending.",
    "{count} 部": "{count} shows",
    "{count} 集记录": "{count} episodes",
    "看到 {time}": "At {time}",
    "已看 {time}": "Watched {time}",
    "第 {episode} 集": "Episode {episode}",
    "{show} - 剧迹": "{show} - VideoTracker",
    "已导出 {shows} 部剧、{episodes} 集记录": "Exported {shows} shows and {episodes} episode records",
    "已合并 {shows} 部剧、{episodes} 集记录": "Merged {shows} shows and {episodes} episode records",
    "确定删除“{name}”及其所有分集记录？此操作不可撤销。": "Delete \"{name}\" and all episode records? This cannot be undone.",
    "确定删除“{name}”这一集的记录？如果它是该剧最后一条记录，剧集条目也会一并删除。": "Delete the record for \"{name}\"? If it is the last episode, the show entry will be removed too.",
    "确定删除“{name}”的观看记录？此操作不可撤销。": "Delete the watch record for \"{name}\"? This cannot be undone.",
    "编辑{name}": "Edit {name}",
    "置顶": "Pin",
    "取消置顶": "Unpin",
    "置顶{name}": "Pin {name}",
    "取消置顶{name}": "Unpin {name}",
    "已置顶{name}": "{name} pinned",
    "已取消置顶{name}": "{name} unpinned",
    "置顶失败": "Unable to update pin",
    "删除{name}": "Delete {name}",
    "打开{name}": "Open {name}",
    "本集观看进度": "Episode watch progress",
    "{name}观看进度": "{name} watch progress",
    "{minutes} 分钟": "{minutes} min",
    "{hours} 小时 {minutes} 分": "{hours} hr {minutes} min",
    "{hours} 小时": "{hours} hr",
    "在线 {time}": "Online {time}",
    "局域网 {ip}": "LAN {ip}",
    "公网 {ip}": "Public {ip}",
    "编辑{name}名称": "Edit {name} name",
    "打开{episode}": "Open {episode}",
    "删除{episode}记录": "Delete {episode} record",
    "筛选分集记录": "Filter episode records",
    "最近观看 {time}": "Last watched {time}",
    "{site}": "{site}"
  };

  function interpolate(template, values) {
    const data = values || {};
    return String(template).replace(/\{(\w+)\}/g, (_match, key) =>
      data[key] == null ? `{${key}}` : String(data[key])
    );
  }

  function t(key, values) {
    const source = String(key == null ? "" : key);
    const translated = language === "en" ? english[source] || source : source;
    return interpolate(translated, values);
  }

  function localizeText(value) {
    const source = String(value == null ? "" : value);
    const trimmed = source.trim();
    if (!trimmed || language !== "en") {
      return source;
    }
    const translated = english[trimmed];
    if (!translated) {
      return source;
    }
    const start = source.indexOf(trimmed);
    return `${source.slice(0, start)}${translated}${source.slice(start + trimmed.length)}`;
  }

  function episodeLabel(value) {
    const source = String(value == null ? "" : value);
    if (language !== "en") {
      return source;
    }
    const core = root.VideoTrackerCore;
    const number = core && core.parseEpisodeNumber
      ? core.parseEpisodeNumber(source)
      : null;
    return number == null ? source : `Episode ${number}`;
  }

  function relativeTime(value) {
    const core = root.VideoTrackerCore;
    return core && core.formatRelativeTime
      ? core.formatRelativeTime(value, Date.now(), locale)
      : "";
  }

  function siteLabel(value) {
    return language === "en" ? t(value) : String(value || "");
  }

  function setLanguage(value) {
    if (value !== "zh" && value !== "en") {
      return;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    }
    if (typeof location !== "undefined") {
      location.reload();
    }
  }

  function localize(node) {
    const scope = node || (typeof document !== "undefined" ? document : null);
    if (!scope || typeof document === "undefined") {
      return;
    }
    if (typeof scope.nodeType === "number" && scope.nodeType === Node.TEXT_NODE) {
      scope.nodeValue = localizeText(scope.nodeValue);
      return;
    }

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (
        parent &&
        !/^(SCRIPT|STYLE|CODE)$/i.test(parent.tagName)
      ) {
        textNodes.push(walker.currentNode);
      }
    }
    for (const textNode of textNodes) {
      textNode.nodeValue = localizeText(textNode.nodeValue);
    }

    for (const element of scope.querySelectorAll("[title], [placeholder], [aria-label]")) {
      for (const attribute of ["title", "placeholder", "aria-label"]) {
        if (element.hasAttribute(attribute)) {
          element.setAttribute(
            attribute,
            localizeText(element.getAttribute(attribute))
          );
        }
      }
    }
    document.documentElement.lang = locale;
  }

  const api = Object.freeze({
    language,
    locale,
    episodeLabel,
    localize,
    localizeText,
    relativeTime,
    setLanguage,
    siteLabel,
    t
  });
  root.VideoTrackerI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
