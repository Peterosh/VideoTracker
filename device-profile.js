(function attachDeviceProfile(root) {
  "use strict";

  const STORAGE_KEY = "vt.deviceProfile.v1";
  const NETWORK_INFO_KEY = "vt.networkInfoEnabled";
  const NETWORK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const PUBLIC_IP_PROVIDERS = [
    {
      name: "ipify",
      parse: (data) => data && data.ip,
      url: "https://api64.ipify.org?format=json"
    },
    {
      name: "ipify4",
      parse: (data) => data && data.ip,
      url: "https://api.ipify.org?format=json"
    },
    {
      name: "myip",
      parse: (data) => data && data.ip,
      url: "https://api.myip.com"
    }
  ];

  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function setStorage(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  function detectPlatform() {
    const raw =
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      (root.VideoTrackerI18n
        ? root.VideoTrackerI18n.t("未知平台")
        : "Unknown platform");
    if (/win/i.test(raw)) {
      return "Windows";
    }
    if (/mac/i.test(raw)) {
      return "macOS";
    }
    if (/linux/i.test(raw)) {
      return "Linux";
    }
    return raw;
  }

  function detectBrowser() {
    const brands =
      (navigator.userAgentData && navigator.userAgentData.brands) || [];
    if (brands.some((brand) => /Microsoft Edge/i.test(brand.brand))) {
      return "Microsoft Edge";
    }
    if (brands.some((brand) => /Google Chrome/i.test(brand.brand))) {
      return "Google Chrome";
    }
    const userAgent = navigator.userAgent || "";
    if (/Edg\//i.test(userAgent)) {
      return "Microsoft Edge";
    }
    if (/Chrome\//i.test(userAgent)) {
      return "Google Chrome";
    }
    return "Chromium";
  }

  function createDeviceId() {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `device-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function isPrivateIpv4(address) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
      return false;
    }
    return (
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    );
  }

  function rankAddress(address) {
    if (address.startsWith("10.")) {
      return 0;
    }
    if (address.startsWith("192.168.")) {
      return 1;
    }
    return 2;
  }

  async function detectLocalIp() {
    if (typeof RTCPeerConnection !== "function") {
      return "";
    }

    return new Promise((resolve) => {
      const addresses = new Set();
      const peer = new RTCPeerConnection({ iceServers: [] });
      const finish = () => {
        try {
          peer.close();
        } catch (_error) {
          // The peer may already be closed after a browser policy failure.
        }
        const selected = Array.from(addresses)
          .filter(isPrivateIpv4)
          .sort((left, right) => rankAddress(left) - rankAddress(right))[0];
        resolve(selected || "");
      };

      const timeout = setTimeout(finish, 1800);
      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timeout);
          finish();
          return;
        }
        const parts = String(event.candidate.candidate).split(/\s+/);
        if (parts[4] && isPrivateIpv4(parts[4])) {
          addresses.add(parts[4]);
        }
      };

      peer.createDataChannel("device-profile");
      peer
        .createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timeout);
          finish();
        });
    });
  }

  function isIpAddress(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 64) {
      return false;
    }
    return (
      /^(\d{1,3}\.){3}\d{1,3}$/.test(text) ||
      /^[0-9a-f:]+$/i.test(text)
    );
  }

  async function detectPublicIp() {
    const deadline = Date.now() + 3500;
    for (const provider of PUBLIC_IP_PROVIDERS) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(remaining, 1800)
      );
      try {
        const response = await fetch(provider.url, {
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (!response.ok) {
          continue;
        }
        const data = await response.json();
        const address = String(provider.parse(data) || "").trim();
        if (isIpAddress(address)) {
          return { address, provider: provider.name };
        }
      } catch (_error) {
        // Try the next provider if this endpoint is blocked or unavailable.
      } finally {
        clearTimeout(timeout);
      }
    }
    return { address: "", provider: "" };
  }

  async function readProfile() {
    const result = await getStorage(STORAGE_KEY);
    return result[STORAGE_KEY] || null;
  }

  async function getNetworkInfoEnabled() {
    const result = await getStorage(NETWORK_INFO_KEY);
    return Boolean(result[NETWORK_INFO_KEY]);
  }

  async function setNetworkInfoEnabled(enabled) {
    const value = Boolean(enabled);
    await setStorage({ [NETWORK_INFO_KEY]: value });
    if (value) {
      return ensure({ refreshNetwork: true });
    }

    const existing = (await readProfile()) || (await ensure());
    const profile = {
      ...existing,
      localIp: "",
      networkUpdatedAt: 0,
      publicIp: "",
      publicIpProvider: "",
      publicIpUpdatedAt: 0,
      updatedAt: Date.now()
    };
    await setStorage({ [STORAGE_KEY]: profile });
    return profile;
  }

  async function ensure(options) {
    const settings = options || {};
    const existing = await readProfile();
    const browser = detectBrowser();
    const platform = detectPlatform();
    const defaultName = `${browser} · ${platform}`;
    const now = Date.now();
    const networkInfoEnabled = await getNetworkInfoEnabled();
    const shouldRefreshLocalIp =
      networkInfoEnabled &&
      (settings.refreshNetwork ||
      !existing ||
      !existing.localIp ||
      now - Number(existing.networkUpdatedAt || 0) > NETWORK_MAX_AGE_MS);
    const shouldRefreshPublicIp =
      networkInfoEnabled &&
      (settings.refreshNetwork ||
      !existing ||
      !existing.publicIp ||
      now - Number(existing.publicIpUpdatedAt || 0) > NETWORK_MAX_AGE_MS);
    const [localIp, publicIpResult] = await Promise.all([
      shouldRefreshLocalIp ? detectLocalIp() : existing && existing.localIp,
      shouldRefreshPublicIp
        ? detectPublicIp()
        : Promise.resolve({
            address: existing && existing.publicIp,
            provider: (existing && existing.publicIpProvider) || ""
          })
    ]);
    const profile = {
      browser,
      customName: Boolean(existing && existing.customName),
      id: (existing && existing.id) || createDeviceId(),
      localIp: networkInfoEnabled ? localIp || "" : "",
      name:
        existing && existing.customName
          ? existing.name
          : defaultName,
      nameUpdatedAt: Number(existing && existing.nameUpdatedAt) || 0,
      networkUpdatedAt: shouldRefreshLocalIp
        ? now
        : existing && existing.networkUpdatedAt,
      platform,
      publicIp: networkInfoEnabled ? publicIpResult.address || "" : "",
      publicIpProvider: networkInfoEnabled
        ? publicIpResult.provider || ""
        : "",
      publicIpUpdatedAt: networkInfoEnabled && shouldRefreshPublicIp
        ? now
        : existing && existing.publicIpUpdatedAt,
      updatedAt: now
    };
    await setStorage({ [STORAGE_KEY]: profile });
    return profile;
  }

  async function rename(name) {
    const existing = (await readProfile()) || (await ensure());
    const profile = {
      ...existing,
      customName: true,
      name: String(name || "").trim().slice(0, 60) || existing.name,
      nameUpdatedAt: Date.now(),
      updatedAt: Date.now()
    };
    await setStorage({ [STORAGE_KEY]: profile });
    return profile;
  }

  root.VideoTrackerDeviceProfile = Object.freeze({
    ensure,
    getNetworkInfoEnabled,
    read: readProfile,
    rename,
    setNetworkInfoEnabled
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
