"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { icons } = require("lucide");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const assetsDirectory = path.join(root, "assets");

const iconMap = {
  check: "Check",
  "chevron-left": "ChevronLeft",
  "chevron-right": "ChevronRight",
  "circle-check": "CircleCheck",
  "circle-stop": "CircleStop",
  clock: "Clock",
  download: "Download",
  "external-link": "ExternalLink",
  film: "Film",
  "layout-list": "LayoutList",
  "loader-circle": "LoaderCircle",
  "monitor-play": "MonitorPlay",
  pencil: "Pencil",
  play: "Play",
  "refresh-cw": "RefreshCw",
  search: "Search",
  "trash-2": "Trash2",
  upload: "Upload",
  x: "X"
};

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nodeToMarkup(node) {
  if (!Array.isArray(node) || !node[0]) {
    return "";
  }

  const tag = node[0];
  const attributes = node[1] || {};
  const attributeText = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ");
  const children = Array.isArray(node[2])
    ? node[2].map(nodeToMarkup).join("")
    : "";

  return `<${tag}${attributeText ? ` ${attributeText}` : ""}>${children}</${tag}>`;
}

function generateIconModule() {
  const entries = Object.entries(iconMap).map(([name, exportName]) => {
    const icon = icons[exportName];
    if (!icon) {
      throw new Error(`Lucide icon not found: ${exportName}`);
    }
    return `  ${JSON.stringify(name)}: ${JSON.stringify(icon.map(nodeToMarkup).join(""))}`;
  });

  const source = `// Generated from Lucide ${require("lucide/package.json").version}; see THIRD_PARTY_NOTICES.md.
(function attachVideoTrackerIcons(root) {
  root.VideoTrackerIconPaths = Object.freeze({
${entries.join(",\n")}
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

  fs.writeFileSync(path.join(root, "icons.js"), source, "utf8");
}

async function generateAppIcons() {
  fs.mkdirSync(assetsDirectory, { recursive: true });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="5" y="5" width="118" height="118" rx="28" fill="#0f110f" stroke="#2b3028" stroke-width="2"/>
  <rect x="21" y="27" width="86" height="70" rx="14" fill="#241c11" stroke="#f4b860" stroke-width="7"/>
  <path d="M54 45v34l29-17z" fill="#f4b860"/>
  <rect x="34" y="84" width="34" height="6" rx="3" fill="#69d39d"/>
  <circle cx="99" cy="101" r="12" fill="#69d39d" stroke="#0f110f" stroke-width="7"/>
</svg>
`;

  fs.writeFileSync(path.join(assetsDirectory, "icon.svg"), svg, "utf8");

  for (const size of [16, 32, 48, 128]) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(assetsDirectory, `icon-${size}.png`));
  }
}

async function main() {
  generateIconModule();
  await generateAppIcons();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
