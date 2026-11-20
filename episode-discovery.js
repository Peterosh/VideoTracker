(function attachEpisodeDiscovery(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
    return;
  }

  root.VideoTrackerEpisodeDiscovery = factory(root.VideoTrackerCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function createEpisodeDiscovery(
  Core
) {
  "use strict";

  const MAX_EPISODE_NUMBER = 9999;
  const MAX_SOURCE_LENGTH = 2500000;

  function decodeHtmlEntities(value) {
    return String(value == null ? "" : value)
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
        const number = Number.parseInt(code, 16);
        return Number.isFinite(number) ? String.fromCodePoint(number) : "";
      })
      .replace(/&#(\d+);/g, (_match, code) => {
        const number = Number.parseInt(code, 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : "";
      })
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }

  function normalizeSource(value) {
    return decodeHtmlEntities(
      String(value == null ? "" : value)
        .slice(0, MAX_SOURCE_LENGTH)
        .replace(/\\u([0-9a-f]{4})/gi, (_match, code) =>
          String.fromCharCode(Number.parseInt(code, 16))
        )
        .replace(/\\\//g, "/")
    );
  }

  function validEpisodeNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) &&
      number > 0 &&
      number <= MAX_EPISODE_NUMBER
      ? number
      : null;
  }

  function episodeLabelFromNumber(value) {
    const number = validEpisodeNumber(value);
    if (!number) {
      return "";
    }
    return Core && Core.episodeLabelFromNumber
      ? Core.episodeLabelFromNumber(number)
      : `第 ${number} 集`;
  }

  function addCandidate(candidates, value, source, confidence) {
    const number = validEpisodeNumber(value);
    if (!number) {
      return;
    }
    candidates.push({
      confidence: Number(confidence) || 0,
      label: episodeLabelFromNumber(number),
      number,
      source
    });
  }

  function collectTextCandidates(source, candidates) {
    const latestPatterns = [
      {
        expression:
          /(?:更新(?:至|到)?|已更新(?:至|到)?|连载至|連載至|最新(?:一集|集数|集數)?)\s*(?:第)?\s*(\d{1,4})\s*[集话話回期]?/gi,
        source: "latest-range"
      },
      {
        expression:
          /(?:全|共)\s*(?:第)?\s*(\d{1,4})\s*[集话話回期]/gi,
        source: "latest-range"
      },
      {
        expression:
          /第\s*(\d{1,4})\s*[集话話回期]\s*(?:已更新|已上线|已上線|更新|上线|上線)/gi,
        source: "latest-range"
      },
      {
        expression: /先行\s*(\d{1,4})\s*[集话話]/gi,
        source: "preview"
      },
      {
        expression:
          /\b(?:updated?\s+to|latest(?:\s+episode)?)\s*(?:episode|ep)?\s*[.\-:：]?\s*(\d{1,4})\b/gi,
        source: "latest-range"
      }
    ];
    const fallbackPatterns = [
      {
        expression:
          /第\s*[0-9零〇一二两三四五六七八九十百千万]+\s*[集话話回期]/g,
        source: "label"
      },
      {
        expression: /\bS\d{1,2}\s*E(\d{1,4})\b/gi,
        source: "season"
      },
      {
        expression: /\b(?:Episode|EP?)\s*[.\-:：]?\s*(\d{1,4})\b/gi,
        source: "prefixed"
      },
    ];
    const structuredPatterns = [
      {
        expression:
          /["'](?:latestEpisode(?:No|Number|Num)?|latest_episode(?:_number)?|newestEpisode(?:No|Number|Num)?|totalEpisodes?|total_episode(?:_count)?|episodeTotal|episode_count|maxEpisode(?:No|Number)?|max_episode|numEpisodes?|更新集数|更新集數|最新集)["']\s*[:=]\s*["']?(\d{1,4})\b/gi,
        source: "structured-latest"
      },
      {
        expression:
          /["'](?:episode(?:No|Number|Num)?|episode_num|videoEpisode|currentEpisode|ep|ji|集数|集數)["']\s*[:=]\s*["']?(\d{1,4})\b/gi,
        source: "structured-current"
      }
    ];

    for (const pattern of latestPatterns) {
      let match;
      while ((match = pattern.expression.exec(source))) {
        addCandidate(candidates, match[1], pattern.source, 100);
      }
    }

    for (const pattern of structuredPatterns) {
      let match;
      while ((match = pattern.expression.exec(source))) {
        addCandidate(
          candidates,
          match[1],
          "structured",
          pattern.source === "structured-latest" ? 100 : 80
        );
      }
    }

    for (const pattern of fallbackPatterns) {
      let match;
      while ((match = pattern.expression.exec(source))) {
        const number =
          pattern.source === "label" && Core && Core.parseEpisodeNumber
            ? Core.parseEpisodeNumber(match[0])
            : match[1];
        addCandidate(candidates, number, pattern.source, 55);
      }
    }
  }

  function episodeNumbersFromUrl(value) {
    const numbers = [];
    let parsed;
    try {
      parsed = new URL(value, "https://video.invalid");
    } catch (_error) {
      return numbers;
    }

    for (const [key, rawValue] of parsed.searchParams.entries()) {
      if (
        /^(?:ep|episode|episodeNo|episodeNumber|episode_num|ji)$/i.test(key)
      ) {
        const match = String(rawValue).match(/\d{1,4}/);
        if (match) {
          numbers.push(Number(match[0]));
        }
      }
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    for (const segment of segments) {
      const direct =
        segment.match(/^(?:ep|episode|e)(\d{1,4})(?:\.html?)?$/i) ||
        segment.match(/(?:^|[-_])(?:ep|episode)[-_]?(\d{1,4})(?:[-_.]|$)/i);
      if (direct) {
        numbers.push(Number(direct[1]));
      }

      const compound = segment.match(
        /^(?:vodplay|play|video)[-_](\d{1,4})[-_](\d{1,4})(?:\.html?)?$/i
      );
      if (compound) {
        numbers.push(Number(compound[2]));
      }
    }

    const markerIndex = segments.findIndex((segment) =>
      /^(?:play|watch|episode|video)$/i.test(segment)
    );
    if (markerIndex >= 0) {
      for (const segment of segments.slice(markerIndex + 1)) {
        const match = segment.match(/^(?:ep)?(\d{1,4})(?:\.html?)?$/i);
        if (match) {
          numbers.push(Number(match[1]));
        }
      }
    }

    return numbers;
  }

  function optionalUrl(value, base) {
    try {
      return new URL(value, base || undefined);
    } catch (_error) {
      return null;
    }
  }

  function seriesUrlBase(value) {
    const parsed = optionalUrl(value);
    if (!parsed) {
      return "";
    }

    let pathname = parsed.pathname.replace(/\/+$/, "");
    const removablePatterns = [
      /\/play\/\d+\/\d+(?:\.html?)?$/i,
      /\/play\/\d+(?:\.html?)?$/i,
      /\/(?:ep|episode|e)[-_]?\d+(?:\.html?)?$/i,
      /\/(?:vodplay|video)[-_]\d+[-_]\d+(?:\.html?)?$/i,
      /\/\d+(?:\.html?)?$/
    ];
    for (const pattern of removablePatterns) {
      if (pattern.test(pathname)) {
        pathname = pathname.replace(pattern, "");
        break;
      }
    }
    pathname = pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}/`;
  }

  function urlMatchesSeries(value, seriesBase) {
    if (!seriesBase) {
      return false;
    }
    const parsed = optionalUrl(value, seriesBase);
    const series = optionalUrl(seriesBase);
    return Boolean(
      parsed &&
        series &&
        parsed.origin === series.origin &&
        `${parsed.pathname.replace(/\/+$/, "")}/`.startsWith(
          `${series.pathname.replace(/\/+$/, "")}/`
        )
    );
  }

  function collectUrlCandidates(source, candidates, currentUrl) {
    const seriesBase = seriesUrlBase(currentUrl);
    const urlPattern = /(?:https?:\/\/|\/)[^\s"'<>]+/gi;
    let match;
    while ((match = urlPattern.exec(source))) {
      const value = match[0].replace(/[),.;\]}]+$/g, "");
      const belongsToSeries = urlMatchesSeries(value, seriesBase);
      if (seriesBase && !belongsToSeries) {
        continue;
      }
      for (const number of episodeNumbersFromUrl(value)) {
        addCandidate(
          candidates,
          number,
          "url",
          belongsToSeries ? 120 : 30
        );
      }
    }
  }

  function extractLatestEpisode(value, options) {
    const settings = options || {};
    const source = normalizeSource(value);
    if (!source) {
      return null;
    }

    const candidates = [];
    collectTextCandidates(source, candidates);
    collectUrlCandidates(source, candidates, settings.currentUrl);
    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      if (right.number !== left.number) {
        return right.number - left.number;
      }
      const priority = {
        preview: 6,
        "latest-range": 5,
        structured: 4,
        url: 3,
        prefixed: 2,
        label: 2,
        season: 2
      };
      return (priority[right.source] || 0) - (priority[left.source] || 0);
    });

    const best = candidates[0];
    return {
      candidateCount: candidates.length,
      confidence: best.confidence,
      label: best.label,
      number: best.number,
      source: best.source
    };
  }

  return Object.freeze({
    extractLatestEpisode
  });
});
