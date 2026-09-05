const waitForInjectionHost = ({ timeoutMs = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    const host = document.head || document.documentElement;
    if (host) {
      resolve(host);
      return;
    }

    const timeoutId = setTimeout(() => {
      try {
        observer.disconnect();
      } catch {}
      reject(new Error("Timed out waiting for document root"));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const nextHost = document.head || document.documentElement;
      if (!nextHost) return;
      clearTimeout(timeoutId);
      try {
        observer.disconnect();
      } catch {}
      resolve(nextHost);
    });

    try {
      observer.observe(document, { childList: true, subtree: true });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });

const FF_LAUNCH_OVERLAY_ID = "ff-launch-overlay";
const showLaunchOverlay = () => {
  if (window !== window.top || document.getElementById(FF_LAUNCH_OVERLAY_ID)) return;
  const overlay = document.createElement("div");
  overlay.id = FF_LAUNCH_OVERLAY_ID;
  overlay.innerHTML = `
    <div class="ff-launch-topbar"><strong>EA SPORTS FC 26</strong><span>FODDER FLOW</span></div>
    <div class="ff-launch-brand"><img src="${chrome.runtime.getURL("icons/fodder-flow-logo.png")}" alt="Fodder Flow" /><span>Preparing Companion tools…</span></div>
    <p>The use of certain player names and likenesses is done on a collective basis and is authorized as required by the relevant rights holders.</p>
  `;
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;color:#fff;background:#0d0d18 radial-gradient(circle at 88% 8%,rgba(0,220,150,.38),transparent 28%),radial-gradient(circle at 5% 70%,rgba(0,180,220,.30),transparent 30%),radial-gradient(circle at 60% 35%,rgba(60,65,170,.24),transparent 38%);font-family:system-ui,sans-serif;display:grid;place-items:center;overflow:hidden";
  const style = document.createElement("style");
  style.textContent = `
    #${FF_LAUNCH_OVERLAY_ID} .ff-launch-topbar{position:absolute;inset:0 0 auto;height:54px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;background:#1d1d26;color:#d8d8df;font-size:17px;letter-spacing:.5px}
    #${FF_LAUNCH_OVERLAY_ID} .ff-launch-brand{position:absolute;top:96px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px}
    #${FF_LAUNCH_OVERLAY_ID} .ff-launch-brand img{width:150px;height:150px;border-radius:18px;object-fit:contain;filter:drop-shadow(0 0 18px rgba(231,196,58,.38))}
    #${FF_LAUNCH_OVERLAY_ID} .ff-launch-brand span{color:rgba(255,255,255,.68);font-size:13px}
    #${FF_LAUNCH_OVERLAY_ID} p{position:absolute;left:50%;bottom:11%;transform:translateX(-50%);width:min(620px,80vw);margin:0;color:rgba(255,255,255,.72);font-size:18px;line-height:1.45;text-align:center}
  `;
  overlay.appendChild(style);
  document.documentElement.appendChild(overlay);
  const readySelector = [
    'input[type="email"]',
    'input[name*="email" i]',
    '.ut-login-content',
    '.ut-navigation-container-view',
    '.ut-home-hub-view',
  ].join(",");
  let observer = null;
  const hide = () => {
    observer?.disconnect();
    overlay.remove();
  };
  const hideWhenLoginArrives = () => {
    let target = null;
    try {
      target = document.querySelector(readySelector);
      if (!target) {
        target = Array.from(document.querySelectorAll("button, a")).find(
          (node) =>
            !node.closest(`#${FF_LAUNCH_OVERLAY_ID}`) &&
            /^(log\s*in|login|sign\s*in|get started|getting started)$/i.test(
              String(node.textContent ?? "").trim(),
            ),
        );
      }
    } catch {}
    if (!target) return false;
    hide();
    return true;
  };
  if (!hideWhenLoginArrives()) {
    observer = new MutationObserver(hideWhenLoginArrives);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  setTimeout(hide, 45000);
};

showLaunchOverlay();

const injectPageScript = async (path, { type = "module" } = {}) =>
  new Promise(async (resolve, reject) => {
    const script = document.createElement("script");
    const src = chrome.runtime.getURL(path);
    script.src = src;
    if (type) script.type = type;
    script.onload = function () {
      script.parentNode?.removeChild(script);
      resolve({ path, type: type || "classic", src });
    };
    script.onerror = function (errorEvent) {
      script.parentNode?.removeChild(script);
      const error = new Error(
        `[EA Data] Failed to inject script: ${path} (${type || "classic"})`,
      );
      error.path = path;
      error.injectType = type || "classic";
      error.src = src;
      error.eventType = errorEvent?.type ?? null;
      reject(error);
    };
    try {
      const host = await waitForInjectionHost();
      host.appendChild(script);
    } catch (error) {
      reject(error);
    }
  });

const BRIDGE_INJECT_REQUEST = "EA_PAGE_BRIDGE_INJECT";

const requestBackgroundBridgeInject = (path) =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: BRIDGE_INJECT_REQUEST,
          payload: { path, href: location.href },
        },
        (response) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(
              new Error(
                runtimeError.message || "Background bridge injection failed",
              ),
            );
            return;
          }
          if (response?.ok) {
            resolve(response?.data ?? { injected: true, path });
            return;
          }
          reject(
            new Error(
              response?.error?.message || "Background bridge injection failed",
            ),
          );
        },
      );
    } catch (error) {
      reject(error);
    }
  });

const exposeExtensionMetadataToPage = async () => {
  try {
    const root = document.documentElement;
    const manifest = chrome.runtime.getManifest?.() ?? null;
    const version = String(manifest?.version ?? "").trim();
    const baseUrl = String(chrome.runtime.getURL("") ?? "").trim();
    if (root?.dataset) {
      if (version) root.dataset.eaDataExtensionVersion = version;
      if (baseUrl) root.dataset.eaDataExtensionBaseUrl = baseUrl;
    }
    const host = document.head || document.documentElement;
    if (host instanceof HTMLElement) {
      let metaNode = document.getElementById("ea-data-extension-meta");
      if (!(metaNode instanceof HTMLMetaElement)) {
        metaNode = document.createElement("meta");
        metaNode.id = "ea-data-extension-meta";
        metaNode.setAttribute("name", "ea-data-extension-meta");
        host.appendChild(metaNode);
      }
      if (version) metaNode.setAttribute("data-version", version);
      if (baseUrl) metaNode.setAttribute("data-base-url", baseUrl);
    }
  } catch (error) {
    console.warn("[EA Data] Failed to expose extension metadata", {
      message: error?.message ?? String(error),
    });
  }
};

const FF_UPDATE_OVERLAY_ID = "ff-update-required-overlay";

const getUpdateStatus = () =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "FF_GET_UPDATE_STATUS" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response?.data || null);
      });
    } catch {
      resolve(null);
    }
  });

const renderUpdateRequiredOverlay = (status) => {
  if (document.getElementById(FF_UPDATE_OVERLAY_ID)) return;
  const host = document.body || document.documentElement;
  if (!host) return;

  const overlay = document.createElement("div");
  overlay.id = FF_UPDATE_OVERLAY_ID;
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,14,0.92);" +
    "display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#17181d;color:#f3f3f3;padding:28px 32px;border-radius:12px;" +
    "max-width:420px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);";

  const latest = status?.latestVersion ? String(status.latestVersion) : "a newer version";
  const current = status?.currentVersion ? String(status.currentVersion) : "";

  card.innerHTML =
    `<div style="font-size:18px;font-weight:700;margin-bottom:8px;">Update required</div>` +
    `<div style="font-size:14px;line-height:1.5;opacity:0.85;margin-bottom:18px;">` +
    `AutopilotSBC ${current ? `(v${current}) ` : ""}is out of date. Version ${latest} is available ` +
    `and this extension won't run until you update.</div>` +
    `<button id="ff-update-now-btn" style="background:#2f7dfa;color:#fff;border:none;` +
    `padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">` +
    `Get update</button>` +
    `<div style="font-size:12px;opacity:0.6;margin-top:14px;">` +
    `Opens the latest download. Replace the old extension folder, then reload it from ` +
    `chrome://extensions.</div>`;

  overlay.appendChild(card);
  host.appendChild(overlay);

  const btn = card.querySelector("#ff-update-now-btn");
  btn?.addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({
        type: "FF_OPEN_UPDATE_LINK",
        url: status?.releaseUrl,
      });
    } catch {}
  });
};

void (async () => {
  if (window !== window.top) return;

  const updateStatus = await getUpdateStatus();
  if (updateStatus?.updateAvailable) {
    renderUpdateRequiredOverlay(updateStatus);
    return; // Block: do not inject the page bridge / enable the extension.
  }

  await exposeExtensionMetadataToPage();
  const bridgePath = "page/ea-data-bridge.js";
  try {
    await injectPageScript(bridgePath, { type: "module" });
  } catch (error) {
    console.warn("[EA Data] Module script injection failed; retrying classic", {
      path: error?.path ?? bridgePath,
      type: error?.injectType ?? "module",
      src: error?.src ?? null,
      message: error?.message ?? String(error),
    });
    try {
      await injectPageScript(bridgePath, { type: null });
      console.warn("[EA Data] Classic script injection fallback succeeded", {
        path: bridgePath,
      });
    } catch (fallbackError) {
      try {
        await requestBackgroundBridgeInject(bridgePath);
        console.warn(
          "[EA Data] Background executeScript injection fallback succeeded",
          {
            path: bridgePath,
          },
        );
      } catch (backgroundError) {
        console.error("[EA Data] Script injection failed", {
          moduleError: {
            path: error?.path ?? bridgePath,
            type: error?.injectType ?? "module",
            src: error?.src ?? null,
            message: error?.message ?? String(error),
          },
          fallbackError: {
            path: fallbackError?.path ?? bridgePath,
            type: fallbackError?.injectType ?? "classic",
            src: fallbackError?.src ?? null,
            message: fallbackError?.message ?? String(fallbackError),
          },
          backgroundError: {
            path: bridgePath,
            message: backgroundError?.message ?? String(backgroundError),
          },
          href: location.href,
          frame: window === window.top ? "top" : "child",
          ua: navigator.userAgent,
          at: new Date().toISOString(),
        });
      }
    }
  }
})();

const CONTENT_SCRIPT_VERSION = "2026-09-01a";
console.log("[EA Data] Content script loaded", {
  version: CONTENT_SCRIPT_VERSION,
});

const SOLVER_BRIDGE_REQUEST = "EA_SOLVER_REQUEST";
const SOLVER_BRIDGE_RESPONSE = "EA_SOLVER_RESPONSE";
const SOLVER_BRIDGE_TRACE = "EA_SOLVER_TRACE";
const SOLVER_BRIDGE_PING = "EA_SOLVER_PING";
const SOLVER_BRIDGE_PONG = "EA_SOLVER_PONG";
const SOLVER_BRIDGE_SOURCE = "ea-data-bridge";
const WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";
const SOLVER_PORT_NAME = "EA_SOLVER_PORT";
const EA_DATA_LOG = "EA_DATA_LOG";

const PREF_BRIDGE_GET = "EA_DATA_PREF_GET";
const PREF_BRIDGE_SET = "EA_DATA_PREF_SET";
const PREF_BRIDGE_RES = "EA_DATA_PREF_RES";
const PREF_ALLOWED_KEYS = new Set(["eaData.preferences.v1"]);
const PRICE_BRIDGE_REQUEST = "EA_DATA_PRICE_REQUEST";
const PRICE_BRIDGE_RESPONSE = "EA_DATA_PRICE_RESPONSE";
const FUTGG_PLAYERS_BRIDGE_REQUEST = "EA_DATA_FUTGG_PLAYERS_REQUEST";
const FUTGG_PLAYERS_BRIDGE_RESPONSE = "EA_DATA_FUTGG_PLAYERS_RESPONSE";

// Relay page-world log messages to the content-script console.
// The page script (ea-data-bridge.js) runs in the main world where EA overrides
// console. This listener runs in the isolated world with the native console.
window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    if (event?.data?.type !== EA_DATA_LOG) return;
    const args = event.data.args;
    if (!Array.isArray(args)) return;
    console.log(...args);
  },
  true,
);

let extensionContextReloadScheduled = false;

const isExtensionContextInvalidError = (error) => {
  const message = String(error?.message || error || "");
  if (message.includes("Extension context invalidated")) return true;
  try {
    return !chrome?.runtime?.id;
  } catch {
    return true;
  }
};

const scheduleExtensionContextReload = (error) => {
  if (!isExtensionContextInvalidError(error)) return false;
  if (extensionContextReloadScheduled) return true;
  extensionContextReloadScheduled = true;
  console.warn("[EA Data] Extension updated; reloading the EA Web App.");
  window.setTimeout(() => window.location.reload(), 100);
  return true;
};

const initFodderFlowAuthUi = () => {
  if (window !== window.top || document.getElementById("ff-auth-host")) return;
  const host = document.createElement("div");
  host.id = "ff-auth-host";
  // This control is independent of EA's sign-in UI, so keep it visible on
  // the EA login screen as well as once the Web App has loaded.
  // This is a temporary position until EA renders the balance control. The
  // button is then aligned immediately to the left of the coin total.
  host.style.cssText = "position:fixed;top:16px;left:12px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box;font-family:Arial,sans-serif}button,input{font:inherit}
      .pill{border:0;background:#0d96e9;color:#fff;border-radius:3px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:none;white-space:nowrap}
      .pill.user{background:#202029;border-color:#f2ca50;color:#f2ca50;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .backdrop{display:none;position:fixed;inset:0;background:#0009;align-items:center;justify-content:center;padding:16px}.backdrop.open{display:flex}
      .modal{width:min(414px,100%);background:#201f27;border:1px solid #45434e;border-radius:12px;color:#fff;padding:22px;box-shadow:0 24px 80px #000}
      .head{display:flex;justify-content:space-between;align-items:center}.head h2{font-size:20px;margin:0}.x{border:0;background:transparent;color:#aaa;font-size:24px;cursor:pointer}
      p{color:#bcb9c3;line-height:1.45;margin:20px 0}form{display:grid;gap:14px}input{width:100%;padding:14px 10px;color:#fff;background:#2b2933;border:1px solid #5b5864;border-radius:3px;outline:none}input:focus{border-color:#29bff1}
      .name{display:none}.name.show{display:block}.error{min-height:18px;color:#ff6b6b;font-size:13px}.submit{padding:12px;border:1px solid #d7ad2c;border-radius:5px;background:#3b3323;color:#ffd758;font-weight:800;cursor:pointer}.submit:disabled{opacity:.55}
      .mode,.logout{display:block;width:100%;margin-top:14px;border:0;background:transparent;color:#34c8d5;text-decoration:underline;cursor:pointer}.logout{color:#ff8080}.signed{display:none;text-align:center}.signed.show{display:block}.login.hidden{display:none}
      @media(max-width:900px){:host{right:12px!important;top:62px!important}.pill{padding:7px 9px}}
    </style>
    <button class="pill" id="pill">Sign in to FodderFlow</button>
    <div class="backdrop" id="backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="title">
        <div class="head"><h2 id="title">Sign in to FodderFlow</h2><button class="x" id="close" aria-label="Close">×</button></div>
        <div class="login" id="loginPane">
          <p id="copy">Enter your email and password to sign in to your FodderFlow account.</p>
          <form id="form">
            <input class="name" id="name" maxlength="80" autocomplete="name" placeholder="Name">
            <input id="email" type="email" autocomplete="email" placeholder="Email" required>
            <input id="password" type="password" minlength="8" maxlength="128" autocomplete="current-password" placeholder="Password" required>
            <div class="error" id="error" role="alert"></div>
            <button class="submit" id="submit" type="submit">Sign in</button>
          </form>
          <button class="mode" id="mode">Don't have an account? Sign up on FodderFlow</button>
        </div>
        <div class="signed" id="signedPane"><p id="signedText"></p><button class="logout" id="logout">Sign out</button></div>
      </section>
    </div>`;
  document.documentElement.appendChild(host);

  const positionBesideCoinBalance = () => {
    try {
      // EA's rendered coin value is the only comma-formatted numeric leaf in
      // the top bar (for example "186,760"). Avoid matching parent wrappers.
      const balance = Array.from(document.querySelectorAll("body *"))
        .filter((node) => node !== host && node.children.length === 0)
        .map((node) => ({
          node,
          text: String(node.textContent || "").trim(),
          rect: node.getBoundingClientRect(),
        }))
        .find(
          ({ text, rect }) =>
            /^\d{1,3}(?:,\d{3})+$/.test(text) &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.top < 160,
        );
      if (!balance) return false;

      const hostRect = host.getBoundingClientRect();
      const buttonWidth = hostRect.width || 148;
      const buttonHeight = hostRect.height || 36;
      host.style.left = `${Math.max(8, balance.rect.left - buttonWidth - 8)}px`;
      host.style.top = `${Math.max(8, balance.rect.top + (balance.rect.height - buttonHeight) / 2)}px`;
      return true;
    } catch {
      return false;
    }
  };

  let balancePositionTimer = null;
  const queueBalancePosition = () => {
    if (balancePositionTimer != null) return;
    balancePositionTimer = window.setTimeout(() => {
      balancePositionTimer = null;
      positionBesideCoinBalance();
    }, 80);
  };
  requestAnimationFrame(() => {
    positionBesideCoinBalance();
    window.setTimeout(positionBesideCoinBalance, 500);
    window.setTimeout(positionBesideCoinBalance, 1500);
  });
  new MutationObserver(queueBalancePosition).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", queueBalancePosition);

  // EA's own login screen contains email fields. Previously those fields hid
  // FodderFlow's login control, which is exactly when users need it.
  host.style.display = "block";

  const $ = (id) => root.getElementById(id);
  let authenticated = false;
  let user = null;
  const send = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError && scheduleExtensionContextReload(runtimeError)) return;
        resolve(response || { ok: false });
      });
    } catch (error) {
      if (scheduleExtensionContextReload(error)) return;
      resolve({ ok: false, error: { message: error?.message } });
    }
  });
  const render = () => {
    $("pill").textContent = authenticated ? (user?.name || user?.email || "FodderFlow account") : "Sign in to FodderFlow";
    $("pill").classList.toggle("user", authenticated);
    $("loginPane").classList.toggle("hidden", authenticated);
    $("signedPane").classList.toggle("show", authenticated);
    const expiry = user?.premiumExpiresAt ? new Date(user.premiumExpiresAt) : null;
    const plan = user?.isAdmin ? "Administrator · unlimited access" : user?.premium && expiry
      ? `Premium until ${expiry.toLocaleDateString()}`
      : "Authenticated · local solver access";
    $("signedText").textContent = authenticated ? `${user?.email || "FodderFlow user"}\n${plan}` : "";
    document.dispatchEvent(new CustomEvent("FF_AUTH_STATE", { detail: { authenticated, user } }));
  };
  const open = () => $("backdrop").classList.add("open");
  const close = () => $("backdrop").classList.remove("open");
  $("pill").addEventListener("click", open);
  $("close").addEventListener("click", close);
  $("backdrop").addEventListener("click", (event) => { if (event.target === $("backdrop")) close(); });
  $("mode").addEventListener("click", () => {
    // Account creation belongs on the FodderFlow website, not over the EA UI.
    try { chrome.runtime.sendMessage({ type: "FF_OPEN_SIGNUP" }); } catch {}
    close();
  });
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("submit").disabled = true;
    $("error").textContent = "";
    const response = await send({
      type: "FF_AUTH_LOGIN",
      payload: { name: $("name").value, email: $("email").value, password: $("password").value },
    });
    $("submit").disabled = false;
    if (!response?.ok) { $("error").textContent = response?.error?.message || "Unable to sign in."; return; }
    authenticated = true; user = response.data?.user || null; $("password").value = ""; render(); close();
  });
  $("logout").addEventListener("click", async () => {
    await send({ type: "FF_AUTH_LOGOUT" }); authenticated = false; user = null; render(); close();
  });

  document.addEventListener("click", (event) => {
    if (authenticated) return;
    const protectedControl = event.target?.closest?.(
      'button[class*="ea-data-"], a[class*="ea-data-"], [id^="ea-data-"] button, [id^="ea-data-"] input, [id^="ea-data-"] select',
    );
    if (!protectedControl) return;
    event.preventDefault(); event.stopImmediatePropagation(); open();
  }, true);

  send({ type: "FF_AUTH_STATUS", force: true }).then((response) => {
    authenticated = Boolean(response?.ok && response?.data?.authenticated);
    user = response?.data?.user || null;
    render();
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFodderFlowAuthUi, { once: true });
} else {
  initFodderFlowAuthUi();
}

const solverBridgeSeen = new Set();

let solverWorkerInitPromise = null;
const solverWorkerRequests = new Map();
let solverPort = null;
let localSolverWorker = null;
let localSolverDisabled = false;

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRequestId = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `ea-data-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isTrustedPageMessageEvent = (event) => {
  if (!event) return false;
  if (event.source !== window) return false;
  try {
    const expectedOrigin = window.location?.origin ?? "";
    const origin = event.origin;
    if (origin && origin !== "null" && expectedOrigin && origin !== expectedOrigin) {
      return false;
    }
  } catch {}
  return true;
};

const postSolverTrace = (stage, requestId, details = null) => {
  const detail = { type: SOLVER_BRIDGE_TRACE, requestId, stage, details, source: SOLVER_BRIDGE_SOURCE };
  try {
    window.postMessage(detail, "*");
  } catch {}
  try {
    document.dispatchEvent(new CustomEvent(SOLVER_BRIDGE_TRACE, { detail }));
  } catch {}
};

const markListenerReady = () => {
  try {
    document.documentElement.dataset.eaSolverBridge = "ready";
    document.documentElement.dataset.eaSolverBridgeAt = String(Date.now());
  } catch {}
  postSolverTrace("listener-ready", "content-script", {
    href: location.href,
    frame: window === window.top ? "top" : "child",
  });
};

const postSolverPong = (requestId) => {
  const detail = {
    type: SOLVER_BRIDGE_PONG,
    requestId,
    frame: window === window.top ? "top" : "child",
    href: location.href,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
  try {
    document.dispatchEvent(new CustomEvent(SOLVER_BRIDGE_PONG, { detail }));
  } catch {}
};

if (window === window.top) markListenerReady();

const ensureSolverPort = () => {
  if (solverPort) return solverPort;
  try {
    solverPort = chrome.runtime.connect({ name: SOLVER_PORT_NAME });
  } catch (error) {
    solverPort = null;
    throw error;
  }

  solverPort.onMessage.addListener((msg) => {
    if (!msg || msg.type !== WORKER_RESPONSE) return;
    const requestId = msg.requestId;
    if (!requestId) return;
    const pending = solverWorkerRequests.get(requestId);
    if (!pending) return;
    solverWorkerRequests.delete(requestId);
    try {
      clearTimeout(pending.timerId);
    } catch {}
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(msg.error || new Error("Solver failed"));
  });

  solverPort.onDisconnect.addListener(() => {
    solverPort = null;
    try {
      solverWorkerInitPromise = null;
    } catch {}
    // Fail any in-flight calls quickly.
    for (const [requestId, pending] of solverWorkerRequests.entries()) {
      try {
        clearTimeout(pending.timerId);
      } catch {}
      try {
        pending.reject(new Error("Solver port disconnected"));
      } catch {}
      solverWorkerRequests.delete(requestId);
    }
  });

  return solverPort;
};

const callLocalSolverWorkerOnce = (type, payload, timeoutMs) =>
  new Promise((resolve, reject) => {
    if (!localSolverWorker) {
      reject(new Error("Local solver worker unavailable"));
      return;
    }
    const requestId = createRequestId();
    const timerId = setTimeout(() => {
      solverWorkerRequests.delete(requestId);
      reject(new Error("Local solver timeout"));
    }, Math.max(1000, Number(timeoutMs) || 65000));
    solverWorkerRequests.set(requestId, { resolve, reject, timerId });
    try {
      localSolverWorker.postMessage({ type, requestId, payload });
    } catch (error) {
      solverWorkerRequests.delete(requestId);
      clearTimeout(timerId);
      reject(error);
    }
  });

const initSolverWorker = () => {
  if (solverWorkerInitPromise) return solverWorkerInitPromise;
  solverWorkerInitPromise = (async () => {
    if (localSolverDisabled || typeof Worker === "undefined") {
      return { ready: true, mode: "local-background-fallback" };
    }
    try {
      localSolverWorker = new Worker(
        chrome.runtime.getURL("solver/worker.js"),
        { type: "module", name: "fodder-flow-local-sbc" },
      );
      localSolverWorker.addEventListener("message", (event) => {
        const msg = event.data || {};
        if (msg.type !== WORKER_RESPONSE || !msg.requestId) return;
        const pending = solverWorkerRequests.get(msg.requestId);
        if (!pending) return;
        solverWorkerRequests.delete(msg.requestId);
        clearTimeout(pending.timerId);
        if (msg.ok) pending.resolve(msg.data);
        else pending.reject(msg.error || new Error("Local solver failed"));
      });
      localSolverWorker.addEventListener("error", () => {
        localSolverDisabled = true;
        localSolverWorker = null;
      });
      return await callLocalSolverWorkerOnce("INIT", null, 10000);
    } catch {
      try {
        localSolverWorker?.terminate?.();
      } catch {}
      localSolverWorker = null;
      localSolverDisabled = true;
      return { ready: true, mode: "local-background-fallback" };
    }
  })();
  return solverWorkerInitPromise;
};

const isRetryableSolverError = (error) => {
  const message = String(error?.message || error || "");
  if (!message) return false;
  if (message.includes("disconnected")) return true;
  if (message.includes("Receiving end does not exist")) return true;
  if (message.includes("Could not establish connection")) return true;
  if (message.includes("message port closed")) return true;
  if (message.includes("Attempting to use a disconnected port object"))
    return true;
  if (message.includes("Extension context invalidated")) return true;
  return false;
};

const callSolverWorkerOnce = (type, payload, timeoutMs) =>
  new Promise((resolve, reject) => {
    let port;
    try {
      port = ensureSolverPort();
    } catch (error) {
      reject(error);
      return;
    }

    const requestId = createRequestId();
    const timerId = setTimeout(
      () => {
        solverWorkerRequests.delete(requestId);
        reject(new Error("Solver timeout"));
      },
      Math.max(1000, Number(timeoutMs) || 65000),
    );

    solverWorkerRequests.set(requestId, { resolve, reject, timerId });
    try {
      port.postMessage({
        type: WORKER_RESPONSE,
        requestId,
        workerType: type,
        payload,
      });
    } catch (error) {
      solverWorkerRequests.delete(requestId);
      try {
        clearTimeout(timerId);
      } catch {}
      reject(error);
    }
  });

const callSolverWorker = async (
  type,
  payload,
  timeoutMs,
  { retries = 1 } = {},
) => {
  if (type === "SOLVE") {
    const auth = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: "FF_AUTH_STATUS" }, (response) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            if (scheduleExtensionContextReload(runtimeError)) return;
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        if (scheduleExtensionContextReload(error)) return;
        reject(error);
      }
    });
    if (!auth?.ok || !auth?.data?.authenticated) {
      const error = new Error("Sign in to FodderFlow to use the solver.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
  }
  await initSolverWorker();
  if (localSolverWorker && !localSolverDisabled) {
    try {
      return await callLocalSolverWorkerOnce(type, payload, timeoutMs);
    } catch (error) {
      try {
        localSolverWorker?.terminate?.();
      } catch {}
      localSolverWorker = null;
      localSolverDisabled = true;
      console.warn("[EA Data] Local worker failed; using local background solver", {
        message: error?.message || String(error),
      });
    }
  }
  try {
    return await callSolverWorkerOnce(type, payload, timeoutMs);
  } catch (error) {
    if (scheduleExtensionContextReload(error)) {
      return new Promise(() => {});
    }
    if (!retries || !isRetryableSolverError(error)) throw error;
    // Force a clean reconnect and retry once for MV3 service worker restarts.
    try {
      solverPort?.disconnect?.();
    } catch {}
    solverPort = null;
    try {
      solverWorkerInitPromise = null;
    } catch {}
    await delayMs(60);
    return callSolverWorker(type, payload, timeoutMs, { retries: retries - 1 });
  }
};

const handleSolverError = (error) => {
  const message = error?.message || "Solver bridge failed";
  if (message.includes("Receiving end does not exist")) {
    return {
      code: "BACKGROUND_UNAVAILABLE",
      message:
        "Extension background unavailable. Reload the extension and retry.",
    };
  }
  if (message.includes("disconnected")) {
    return {
      code: "BACKGROUND_UNAVAILABLE",
      message: "Solver disconnected. Retry the solve.",
    };
  }
  return error;
};

const handleSolverBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, payload, source } = data || {};
  if (type !== SOLVER_BRIDGE_REQUEST || !requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  if (solverBridgeSeen.has(requestId)) return;
  solverBridgeSeen.add(requestId);
  // Prevent unbounded growth if the user runs many solves in a single session.
  if (solverBridgeSeen.size > 3000) solverBridgeSeen.clear();

  const shouldDebugLog = Boolean(
    payload?.debug === true || payload?.payload?.debug === true,
  );
  if (shouldDebugLog) {
    console.log("[EA Data] Solver bridge request", {
      requestId,
      workerType: payload?.type,
      debug: true,
      pageDebug: Boolean(payload?.debug),
      solverDebug: Boolean(payload?.payload?.debug),
    });
  }
  postSolverTrace("received", requestId, {
    workerType: payload?.type ?? "SOLVE",
  });

  try {
    const workerType = payload?.type ?? "SOLVE";
    const workerPayload = payload?.payload ?? payload ?? null;
    let result;
    if (workerType === "INIT") {
      result = await initSolverWorker();
    } else {
      result = await callSolverWorker(workerType, workerPayload, 65000);
    }
    const responsePayload = {
      type: SOLVER_BRIDGE_RESPONSE,
      requestId,
      ok: true,
      data: result,
      source: SOLVER_BRIDGE_SOURCE,
    };
    postSolverTrace("responded", requestId, { ok: true });
    window.postMessage(responsePayload, "*");
    document.dispatchEvent(
      new CustomEvent(SOLVER_BRIDGE_RESPONSE, { detail: responsePayload }),
    );
  } catch (error) {
    const normalized = handleSolverError(error);
    const responsePayload = {
      type: SOLVER_BRIDGE_RESPONSE,
      requestId,
      ok: false,
      source: SOLVER_BRIDGE_SOURCE,
      error: normalized?.code
        ? normalized
        : {
            code: "SOLVER_BRIDGE_FAILED",
            message: error?.message || "Solver bridge failed",
          },
    };
    postSolverTrace("responded", requestId, {
      ok: false,
      message: error?.message || "Solver bridge failed",
    });
    window.postMessage(responsePayload, "*");
    document.dispatchEvent(
      new CustomEvent(SOLVER_BRIDGE_RESPONSE, { detail: responsePayload }),
    );
  }
};

const storageLocalGet = (key) =>
  new Promise((resolve, reject) => {
    try {
      if (!chrome?.storage?.local?.get) {
        reject(new Error("chrome.storage.local unavailable"));
        return;
      }
      chrome.storage.local.get([key], (items) => {
        const err = chrome?.runtime?.lastError;
        if (err) {
          if (scheduleExtensionContextReload(err)) return;
          reject(new Error(err.message || "storage get failed"));
          return;
        }
        resolve(items ? items[key] : null);
      });
    } catch (error) {
      if (scheduleExtensionContextReload(error)) return;
      reject(error);
    }
  });

const storageLocalSet = (key, value) =>
  new Promise((resolve, reject) => {
    try {
      if (!chrome?.storage?.local?.set) {
        reject(new Error("chrome.storage.local unavailable"));
        return;
      }
      chrome.storage.local.set({ [key]: value }, () => {
        const err = chrome?.runtime?.lastError;
        if (err) {
          if (scheduleExtensionContextReload(err)) return;
          reject(new Error(err.message || "storage set failed"));
          return;
        }
        resolve(true);
      });
    } catch (error) {
      if (scheduleExtensionContextReload(error)) return;
      reject(error);
    }
  });

const postPrefResponse = (requestId, ok, data, error) => {
  const detail = {
    type: PREF_BRIDGE_RES,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const handlePrefBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, key, value } = data || {};
  if (type !== PREF_BRIDGE_GET && type !== PREF_BRIDGE_SET) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  if (!key) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_INVALID",
      message: "Missing preference key",
    });
    return;
  }
  if (!PREF_ALLOWED_KEYS.has(String(key))) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_FORBIDDEN_KEY",
      message: "Preference key not allowed",
    });
    return;
  }

  try {
    if (type === PREF_BRIDGE_GET) {
      const result = await storageLocalGet(key);
      postPrefResponse(requestId, true, result, null);
      return;
    }
    await storageLocalSet(key, value);
    postPrefResponse(requestId, true, true, null);
  } catch (error) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_FAILED",
      message: error?.message || "Preference request failed",
    });
  }
};

const postPriceResponse = (requestId, ok, data, error) => {
  const detail = {
    type: PRICE_BRIDGE_RESPONSE,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const postFutggPlayersResponse = (requestId, ok, data, error) => {
  const detail = {
    type: FUTGG_PLAYERS_BRIDGE_RESPONSE,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const handlePriceBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, ids } = data || {};
  if (type !== PRICE_BRIDGE_REQUEST) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  console.log("[EA Data] Price bridge request", {
    requestId,
    count: Array.isArray(ids) ? ids.length : 0,
  });
  try {
    chrome.runtime.sendMessage(
      {
        type: PRICE_BRIDGE_REQUEST,
        payload: { ids: Array.isArray(ids) ? ids : [], requestId },
      },
      (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          if (scheduleExtensionContextReload(runtimeError)) return;
          console.log("[EA Data] Price bridge runtime error", {
            requestId,
            message: runtimeError.message || "Price bridge failed",
          });
          postPriceResponse(requestId, false, null, {
            code: "PRICE_BRIDGE_FAILED",
            message: runtimeError.message || "Price bridge failed",
          });
          return;
        }
        if (response?.ok) {
          console.log("[EA Data] Price bridge response", {
            requestId,
            ok: true,
            requestedCount: response?.data?.requestedCount ?? null,
            fetchedCount: response?.data?.fetchedCount ?? null,
            errorCount: response?.data?.errorCount ?? null,
          });
          postPriceResponse(requestId, true, response.data, null);
          return;
        }
        console.log("[EA Data] Price bridge response", {
          requestId,
          ok: false,
          error: response?.error ?? null,
        });
        postPriceResponse(requestId, false, null, response?.error ?? {
          code: "PRICE_BRIDGE_FAILED",
          message: "Price bridge failed",
        });
      },
    );
  } catch (error) {
    if (scheduleExtensionContextReload(error)) return;
    console.log("[EA Data] Price bridge exception", {
      requestId,
      message: error?.message || String(error),
    });
    postPriceResponse(requestId, false, null, {
      code: "PRICE_BRIDGE_FAILED",
      message: error?.message || "Price bridge failed",
    });
  }
};

const handleFutggPlayersBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, payload } = data || {};
  if (type !== FUTGG_PLAYERS_BRIDGE_REQUEST) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: FUTGG_PLAYERS_BRIDGE_REQUEST,
        payload: { ...(payload && typeof payload === "object" ? payload : {}), requestId },
      },
      (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          if (scheduleExtensionContextReload(runtimeError)) return;
          postFutggPlayersResponse(requestId, false, null, {
            code: "FUTGG_PLAYERS_BRIDGE_FAILED",
            message: runtimeError.message || "FUT.GG players bridge failed",
          });
          return;
        }
        if (response?.ok) {
          postFutggPlayersResponse(requestId, true, response.data, null);
          return;
        }
        postFutggPlayersResponse(requestId, false, null, response?.error ?? {
          code: "FUTGG_PLAYERS_BRIDGE_FAILED",
          message: "FUT.GG players bridge failed",
        });
      },
    );
  } catch (error) {
    if (scheduleExtensionContextReload(error)) return;
    postFutggPlayersResponse(requestId, false, null, {
      code: "FUTGG_PLAYERS_BRIDGE_FAILED",
      message: error?.message || "FUT.GG players bridge failed",
    });
  }
};

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handleSolverBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handlePrefBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handlePriceBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handleFutggPlayersBridgeRequest(event.data);
  },
  true,
);

document.addEventListener(SOLVER_BRIDGE_REQUEST, (event) => {
  if (window !== window.top) return;
  handleSolverBridgeRequest(event.detail);
});

document.addEventListener(SOLVER_BRIDGE_PING, (event) => {
  if (window !== window.top) return;
  if (event?.detail?.source !== SOLVER_BRIDGE_SOURCE) return;
  const requestId = event?.detail?.requestId || createRequestId();
  postSolverTrace("ping-received", requestId, { channel: "event" });
  postSolverPong(requestId);
});

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    if (event?.data?.source !== SOLVER_BRIDGE_SOURCE) return;
    if (event?.data?.type !== SOLVER_BRIDGE_PING) return;
    const requestId = event?.data?.requestId || createRequestId();
    postSolverTrace("ping-received", requestId, { channel: "postMessage" });
    postSolverPong(requestId);
  },
  true,
);
