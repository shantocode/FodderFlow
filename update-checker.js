// Checks the GitHub repo for a newer manifest version and gates the
// extension's functionality until the user updates.
//
// NOTE ON LIMITATIONS: this extension is sideloaded ("Load unpacked"),
// not installed from the Chrome Web Store. Chrome's security model does
// not allow a sideloaded extension to silently overwrite its own files
// on disk. True silent auto-install only exists for Web Store installs
// or enterprise-policy installs with a signed .crx + update_url. So this
// module does the next best thing: it detects the new version, BLOCKS
// use of the extension until the user updates, and hands them a direct
// download link + short instructions. The user still has to do the
// final "load unpacked" / reload click themselves.

const REPO_OWNER = "shantocode";
const REPO_NAME = "FodderFlow";
const BRANCHES_TO_TRY = ["main", "master"];
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const REPO_ZIP_URL_TEMPLATE = (branch) =>
  `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${branch}.zip`;

const CHECK_ALARM_NAME = "fodderflow-update-check";
const CHECK_INTERVAL_MINUTES = 30;
const FETCH_TIMEOUT_MS = 8000;
const STORAGE_KEY = "ff_update_status";

const fetchWithTimeout = async (url, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

// Compares two "x.y.z" version strings. Returns 1 if a>b, -1 if a<b, 0 if equal.
const compareVersions = (a, b) => {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

const fetchLatestManifestVersion = async () => {
  let lastError = null;
  for (const branch of BRANCHES_TO_TRY) {
    const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}/manifest.json?cachebust=${Date.now()}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} on branch ${branch}`);
        continue;
      }
      const json = await res.json();
      const version = String(json?.version || "").trim();
      if (version) {
        return { version, branch };
      }
      lastError = new Error(`No version field on branch ${branch}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not read remote manifest.json");
};

const setBadge = (updateAvailable) => {
  try {
    if (!chrome.action) return;
    if (updateAvailable) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d92d20" });
      chrome.action.setTitle({ title: "AutopilotSBC — update required" });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "AutopilotSBC" });
    }
  } catch {}
};

const getStoredStatus = async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data?.[STORAGE_KEY] || null;
};

const saveStatus = async (status) => {
  await chrome.storage.local.set({ [STORAGE_KEY]: status });
  setBadge(!!status?.updateAvailable);
  return status;
};

const runUpdateCheck = async () => {
  const currentVersion = String(chrome.runtime.getManifest()?.version || "0");
  try {
    const { version: latestVersion, branch } = await fetchLatestManifestVersion();
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    return await saveStatus({
      ok: true,
      checkedAt: Date.now(),
      currentVersion,
      latestVersion,
      branch,
      updateAvailable,
      releaseUrl: RELEASES_URL,
      zipUrl: REPO_ZIP_URL_TEMPLATE(branch),
    });
  } catch (error) {
    // Network hiccup or repo unreachable: keep whatever status we had
    // (do NOT clear a previously-detected update, and do NOT block users
    // just because a check failed).
    const previous = await getStoredStatus();
    return await saveStatus({
      ...(previous || {
        currentVersion,
        updateAvailable: false,
        releaseUrl: RELEASES_URL,
      }),
      ok: false,
      checkedAt: Date.now(),
      lastError: error?.message || String(error),
    });
  }
};

export const initUpdateChecker = () => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(CHECK_ALARM_NAME, {
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    });
    runUpdateCheck();
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(CHECK_ALARM_NAME, {
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    });
    runUpdateCheck();
  });

  // Cover the case where the service worker wakes up mid-session
  // (e.g. right after install, before onInstalled's alarm fires).
  runUpdateCheck();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM_NAME) {
      runUpdateCheck();
    }
  });
};

export const handleUpdateStatusMessage = async (message, sendResponse) => {
  if (message?.type === "FF_GET_UPDATE_STATUS") {
    const status = (await getStoredStatus()) || (await runUpdateCheck());
    sendResponse({ ok: true, data: status });
    return true;
  }
  if (message?.type === "FF_FORCE_UPDATE_CHECK") {
    const status = await runUpdateCheck();
    sendResponse({ ok: true, data: status });
    return true;
  }
  return false;
};
