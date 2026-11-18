"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactsRoot = path.resolve(root, "artifacts");

function findBrowserExecutable() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function findPopupTarget(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (response && response.ok) {
      const targets = await response.json();
      const popup = targets.find((target) => target.url.endsWith("/popup.html"));
      if (popup) {
        return popup;
      }
    }
    await delay(150);
  }
  throw new Error("Extension action popup target did not open");
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;

    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) {
        return;
      }
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result);
      }
    });
    socket.addEventListener("open", () => {
      resolve({
        close() {
          socket.close();
        },
        send(method, params) {
          return new Promise((resolveCommand, rejectCommand) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, {
              reject: rejectCommand,
              resolve: resolveCommand
            });
            socket.send(JSON.stringify({ id, method, params: params || {} }));
          });
        }
      });
    }, { once: true });
  });
}

async function waitForPopupReady(cdp) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression:
        "Boolean(document.querySelector('.empty-current, .waiting-state, .track-form, .active-summary'))",
      returnByValue: true
    });
    if (evaluation.result.value) {
      return;
    }
    await delay(150);
  }
  throw new Error("Popup content did not finish rendering");
}

async function main() {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactsRoot, "popup-action-profile-"));
  const debuggingPort = await getFreePort();
  let context;
  let cdp;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: findBrowserExecutable(),
      headless: true,
      args: [
        `--disable-extensions-except=${root}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--load-extension=${root}`,
        `--remote-debugging-port=${debuggingPort}`
      ]
    });

    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("data:text/html,<title>Popup layout check</title>");
    await worker.evaluate(() => chrome.action.openPopup());

    const target = await findPopupTarget(debuggingPort);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitForPopupReady(cdp);
    await delay(100);

    const evaluation = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `JSON.stringify((() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const sync = document.querySelector(".sync-state").getBoundingClientRect();
        const current = document.querySelector(".current-section").getBoundingClientRect();
        const heading = document.querySelector("#libraryTitle").getBoundingClientRect();
        return {
          bodyWidth: document.body.getBoundingClientRect().width,
          brandRight: brand.right,
          currentWidth: current.width,
          documentScrollWidth: document.documentElement.scrollWidth,
          headingHeight: heading.height,
          innerWidth: window.innerWidth,
          syncLeft: sync.left
        };
      })())`,
      returnByValue: true
    });
    const metrics = JSON.parse(evaluation.result.value);

    assert.ok(metrics.innerWidth >= 380, `popup viewport is too narrow: ${metrics.innerWidth}`);
    assert.ok(metrics.bodyWidth >= 380, `popup body is too narrow: ${metrics.bodyWidth}`);
    assert.ok(metrics.currentWidth >= 340, `current section is too narrow: ${metrics.currentWidth}`);
    assert.ok(
      metrics.brandRight <= metrics.syncLeft,
      "brand and sync status must not overlap"
    );
    assert.ok(
      metrics.documentScrollWidth <= metrics.innerWidth + 1,
      "popup should not have horizontal overflow"
    );
    assert.ok(metrics.headingHeight <= 30, "library heading should remain on one line");

    const screenshot = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png"
    });
    fs.writeFileSync(
      path.join(artifactsRoot, "popup-action.png"),
      Buffer.from(screenshot.data, "base64")
    );

    console.log(JSON.stringify({ metrics, screenshot: "artifacts/popup-action.png" }, null, 2));
  } finally {
    if (cdp) {
      cdp.close();
    }
    if (context) {
      await context.close();
    }

    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(`${artifactsRoot}${path.sep}`)) {
      fs.rmSync(resolvedProfile, { force: true, recursive: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
