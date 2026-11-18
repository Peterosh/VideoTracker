(function attachCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.VideoTrackerCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const SITE_DEFINITIONS = [
    { id: "bilibili", label: "哔哩哔哩", host: /(^|\.)bilibili\.com$/i },
    { id: "tencent", label: "腾讯视频", host: /(^|\.)v\.qq\.com$/i },
    { id: "iqiyi", label: "爱奇艺", host: /(^|\.)iqiyi\.com$/i },
    { id: "youku", label: "优酷", host: /(^|\.)youku\.com$/i },
    { id: "mgtv", label: "芒果TV", host: /(^|\.)mgtv\.com$/i },
    { id: "omofun", label: "Omofun", host: /(^|\.)(211dm\.com|omofun[a-z]*\.com)$/i },
    { id: "netflix", label: "Netflix", host: /(^|\.)netflix\.com$/i },
    { id: "youtube", label: "YouTube", host: /(^|\.)youtube\.com$/i },
    { id: "primevideo", label: "Prime Video", host: /(^|\.)primevideo\.com$/i }
  ];

  const SITE_SUFFIXES = [
    /[\s\-_|｜]*腾讯视频(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*爱奇艺(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*优酷(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*芒果TV(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*Omofun动漫(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*(?:哔哩哔哩|bilibili)(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*Netflix(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*Prime Video(?:[\s\-_|｜].*)?$/i,
    /[\s\-_|｜]*YouTube(?:[\s\-_|｜].*)?$/i
  ];

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripSiteSuffix(value) {
    let text = normalizeText(value);
    for (const pattern of SITE_SUFFIXES) {
      text = text.replace(pattern, "");
    }
    return text;
  }

  function extractEpisodeLabel(value) {
    const text = normalizeText(value);
    if (!text) {
      return "";
    }

    const seasonEpisode = text.match(/\bS(\d{1,2})\s*E(\d{1,4})\b/i);
    if (seasonEpisode) {
      return seasonEpisode[0].replace(/\s+/g, "").toUpperCase();
    }

    const chineseEpisode = text.match(
      /第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*([集话話期回])/
    );
    if (chineseEpisode) {
      return `第 ${chineseEpisode[1]} ${chineseEpisode[2]}`;
    }

    const prefixedEpisode = text.match(/\b(?:Episode|EP?)\s*[.\-:：]?\s*(\d{1,4})\b/i);
    if (prefixedEpisode) {
      return `EP ${prefixedEpisode[1]}`;
    }

    const numberedEpisode = text.match(
      /(^|[\s·_-])(\d{1,4})\s*集(?=$|[\s·_:：\-_|｜])/
    );
    if (numberedEpisode) {
      return `第 ${numberedEpisode[2]} 集`;
    }

    return "";
  }

  function episodeLabelFromNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? `第 ${number} 集` : "";
  }

  function chineseNumberToInteger(value) {
    const text = normalizeText(value);
    if (!text) {
      return null;
    }
    if (/^\d+$/.test(text)) {
      return Number(text);
    }

    const digits = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9
    };
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0;
    let section = 0;
    let digit = 0;

    for (const character of text) {
      if (character in digits) {
        digit = digits[character];
        continue;
      }

      const unit = units[character];
      if (!unit) {
        return null;
      }
      if (unit === 10000) {
        section += digit;
        total += (section || 1) * unit;
        section = 0;
        digit = 0;
      } else {
        section += (digit || 1) * unit;
        digit = 0;
      }
    }

    return total + section + digit;
  }

  function parseEpisodeNumber(value) {
    const text = normalizeText(value);
    if (!text) {
      return null;
    }

    const seasonEpisode = text.match(/\bS\d{1,2}\s*E(\d{1,4})\b/i);
    if (seasonEpisode) {
      return Number(seasonEpisode[1]);
    }

    const chineseEpisode = text.match(
      /第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*[集话話期回]/
    );
    if (chineseEpisode) {
      return chineseNumberToInteger(chineseEpisode[1]);
    }

    const prefixedEpisode = text.match(/\b(?:Episode|EP?)\s*[.\-:：]?\s*(\d{1,4})\b/i);
    if (prefixedEpisode) {
      return Number(prefixedEpisode[1]);
    }

    const numberedEpisode = text.match(
      /(^|[\s·_-])(\d{1,4})\s*[集话話期回](?=$|[\s·_:：\-_|｜])/
    );
    return numberedEpisode ? Number(numberedEpisode[2]) : null;
  }

  function cleanSeriesTitle(value) {
    const fallback = stripSiteSuffix(value);
    let text = fallback
      .replace(/^(?:正在播放|正在观看|在线观看)\s*[:：]?\s*/i, "")
      .replace(/\bS\d{1,2}\s*E\d{1,4}\b.*$/i, "")
      .replace(/\b(?:Episode|EP?)\s*[.\-:：]?\s*\d{1,4}\b.*$/i, "")
      .replace(/第\s*[0-9零〇一二两三四五六七八九十百千万]+\s*[集话話期回].*$/g, "")
      .replace(/[\s\-_|｜·:：]*\d{1,4}\s*[集话話期回](?:.*)$/g, "")
      .replace(/\s*[-_|｜]\s*(?:在线观看|高清完整版|免费观看|立即观看).*$/i, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-_|｜·:：]+|[\s\-_|｜·:：]+$/g, "")
      .trim();

    if (!text) {
      text = fallback
        .replace(/^[\s\-_|｜·:：]+|[\s\-_|｜·:：]+$/g, "")
        .trim();
    }

    return text || normalizeText(value);
  }

  function getSite(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (_error) {
      host = "";
    }

    const match = SITE_DEFINITIONS.find((site) => site.host.test(host));
    return match || { id: "generic", label: host.replace(/^www\./i, "") || "网页视频" };
  }

  function getAdapterSeriesId(url, siteId) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return "";
    }

    const path = parsed.pathname;
    let match;

    if (siteId === "bilibili") {
      match = path.match(/\/bangumi\/(?:play|media)\/(ss\d+|md\d+)/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    if (siteId === "tencent") {
      match = path.match(/\/x\/cover\/([^/]+)/i);
      if (match) {
        return `cover:${match[1].toLowerCase()}`;
      }
    }

    if (siteId === "youku") {
      match = path.match(/\/v_show\/([^/.]+)/i);
      if (match) {
        return `show:${match[1].toLowerCase()}`;
      }
    }

    if (siteId === "mgtv") {
      match = path.match(/\/b\/([^/.]+)/i);
      if (match) {
        return `show:${match[1].toLowerCase()}`;
      }
    }

    if (siteId === "omofun") {
      match = path.match(/\/anime\/([^/]+)(?:\.html|\/play\/)/i);
      if (match) {
        return `anime:${match[1].toLowerCase()}`;
      }
    }

    if (siteId === "iqiyi") {
      const albumId =
        parsed.searchParams.get("albumId") ||
        parsed.searchParams.get("albumid") ||
        parsed.searchParams.get("cid");
      if (albumId) {
        return `album:${albumId.toLowerCase()}`;
      }
    }

    return "";
  }

  function deriveSeriesKey(url, title) {
    const site = getSite(url);
    const adapterId = getAdapterSeriesId(url, site.id);
    const titleKey = normalizeText(cleanSeriesTitle(title)).toLocaleLowerCase();
    return `${site.id}:${adapterId || titleKey || "untitled"}`;
  }

  function createShowId(value) {
    const text = String(value || "untitled");
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `show_${(hash >>> 0).toString(36)}`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function calculateProgress(position, duration) {
    const safePosition = Math.max(0, Number(position) || 0);
    const safeDuration = Math.max(0, Number(duration) || 0);
    if (!safeDuration) {
      return 0;
    }
    return Number(clamp((safePosition / safeDuration) * 100, 0, 100).toFixed(1));
  }

  function formatTime(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatRelativeTime(timestamp, now, locale) {
    const value = Number(timestamp) || 0;
    const english = /^en/i.test(locale || "");
    if (!value) {
      return english ? "No record" : "暂无记录";
    }

    const current = Number(now) || Date.now();
    const deltaSeconds = Math.max(0, Math.floor((current - value) / 1000));
    if (deltaSeconds < 60) {
      return english ? "Just now" : "刚刚";
    }

    const deltaMinutes = Math.floor(deltaSeconds / 60);
    if (deltaMinutes < 60) {
      return english ? `${deltaMinutes} min ago` : `${deltaMinutes} 分钟前`;
    }

    const deltaHours = Math.floor(deltaMinutes / 60);
    if (deltaHours < 24) {
      return english ? `${deltaHours} hr ago` : `${deltaHours} 小时前`;
    }

    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays === 1) {
      return english ? "Yesterday" : "昨天";
    }
    if (deltaDays < 7) {
      return english ? `${deltaDays} days ago` : `${deltaDays} 天前`;
    }

    const date = new Date(value);
    return english
      ? date.toLocaleDateString("en-US", { day: "numeric", month: "short" })
      : `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  return Object.freeze({
    calculateProgress,
    cleanSeriesTitle,
    clamp,
    createShowId,
    deriveSeriesKey,
    episodeLabelFromNumber,
    extractEpisodeLabel,
    formatRelativeTime,
    formatTime,
    getAdapterSeriesId,
    getSite,
    normalizeText,
    parseEpisodeNumber,
    stripSiteSuffix
  });
});
