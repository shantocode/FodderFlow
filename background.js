const SOLVER_BRIDGE_REQUEST = "EA_SOLVER_REQUEST";
const SOLVER_PORT_NAME = "EA_SOLVER_PORT";
const WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";
const BRIDGE_INJECT_REQUEST = "EA_PAGE_BRIDGE_INJECT";
const PRICE_BRIDGE_REQUEST = "EA_DATA_PRICE_REQUEST";
const FUTGG_PLAYERS_BRIDGE_REQUEST = "EA_DATA_FUTGG_PLAYERS_REQUEST";
const ALLOWED_BRIDGE_INJECT_PATHS = new Set(["page/ea-data-bridge.js"]);
const FUT_PRICE_API_URL = "https://www.fut.gg/api/fut/player-prices/26/";
const FUT_PLAYERS_API_URL = "https://www.fut.gg/api/fut/players/v2/26/";
// Try the Vercel origin first, then the custom domain. Some ad blockers block
// the former; both deployments must use the same authentication database.
const AUTH_API_BASES = [
  "https://fodderflowggfc.vercel.app/api/auth",
  "https://fodderflow.shant0.xyz/api/auth",
];
const AUTH_STORAGE_KEY = "fodderflowAuth";
const AUTH_CACHE_MS = 5 * 60 * 1000;
let authCache = { checkedAt: 0, authenticated: false, user: null };

const fetchAuth = async (path, options = {}) => {
  let lastError = null;
  for (let index = 0; index < AUTH_API_BASES.length; index += 1) {
    try {
      const response = await fetch(`${AUTH_API_BASES[index]}${path}`, options);
      // A server outage can use the backup too. Do not retry normal 4xx
      // responses: an invalid password should remain an invalid password.
      if (response.status >= 500 && index < AUTH_API_BASES.length - 1) {
        lastError = new Error(`Authentication service returned ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (index === AUTH_API_BASES.length - 1) throw error;
    }
  }
  throw lastError || new Error("Authentication service is unavailable");
};

const fetchApi = async (path, options = {}) => {
  let lastError = null;
  for (let index = 0; index < AUTH_API_BASES.length; index += 1) {
    try {
      const apiBase = AUTH_API_BASES[index].replace(/\/auth$/, "");
      const response = await fetch(`${apiBase}/${path.replace(/^\/+/, "")}`, options);
      if (response.status >= 500 && index < AUTH_API_BASES.length - 1) {
        lastError = new Error(`Service returned ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (index === AUTH_API_BASES.length - 1) throw error;
    }
  }
  throw lastError || new Error("Service unavailable");
};

const readStoredAuth = async () =>
  (await chrome.storage.local.get(AUTH_STORAGE_KEY))?.[AUTH_STORAGE_KEY] ?? null;

const verifyAuth = async ({ force = false } = {}) => {
  if (!force && Date.now() - authCache.checkedAt < AUTH_CACHE_MS) return authCache;
  const stored = await readStoredAuth();
  if (!stored?.token) {
    authCache = { checkedAt: Date.now(), authenticated: false, user: null };
    return authCache;
  }
  try {
    const response = await fetchAuth("/session", {
      headers: { Authorization: `Bearer ${stored.token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Session expired");
    const data = await response.json();
    authCache = { checkedAt: Date.now(), authenticated: true, user: data.user };
  } catch {
    await chrome.storage.local.remove(AUTH_STORAGE_KEY);
    authCache = { checkedAt: Date.now(), authenticated: false, user: null };
  }
  return authCache;
};

const consumeSolverAllowance = async () => {
  const stored = await readStoredAuth();
  if (!stored?.token) throw new Error("Sign in to FodderFlow to use the solver.");
  const response = await fetchApi("solver/consume", {
    method: "POST",
    headers: { Authorization: `Bearer ${stored.token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.allowed) {
    const error = new Error(data.error || "Unable to verify solver allowance.");
    error.code = response.status === 429 ? "DAILY_LIMIT_REACHED" : "ALLOWANCE_FAILED";
    throw error;
  }
  if (data.user) {
    authCache = { checkedAt: Date.now(), authenticated: true, user: data.user };
    await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: { token: stored.token, user: data.user } });
  }
  return data;
};

const handleAuthMessage = async (message, sendResponse) => {
  try {
    if (message.type === "FF_AUTH_STATUS") {
      sendResponse({ ok: true, data: await verifyAuth({ force: message.force === true }) });
      return;
    }
    if (message.type === "FF_AUTH_LOGOUT") {
      const stored = await readStoredAuth();
      if (stored?.token) {
        await fetchAuth("/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${stored.token}` },
        }).catch(() => {});
      }
      await chrome.storage.local.remove(AUTH_STORAGE_KEY);
      authCache = { checkedAt: Date.now(), authenticated: false, user: null };
      sendResponse({ ok: true, data: authCache });
      return;
    }
    const mode = message.type === "FF_AUTH_SIGNUP" ? "signup" : "login";
    const response = await fetchAuth(`/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) throw new Error(data.error || "Authentication failed");
    await chrome.storage.local.set({
      [AUTH_STORAGE_KEY]: { token: data.token, user: data.user },
    });
    authCache = { checkedAt: Date.now(), authenticated: true, user: data.user };
    sendResponse({ ok: true, data: authCache });
  } catch (error) {
    const networkBlocked = error instanceof TypeError && /fetch|network/i.test(String(error?.message));
    sendResponse({
      ok: false,
      error: {
        message: networkBlocked
          ? "Can't reach the sign-in service. Allow fodderflowggfc.vercel.app in your ad blocker, then try again."
          : error?.message || "Authentication failed",
      },
    });
  }
};
const FUT_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const FUT_PRICE_BATCH_SIZE = 10;
const FUT_PRICE_MIN_GAP_MS = 450;
const FUT_PRICE_MAX_IDS_PER_REQUEST = 1000;
const FUT_PRICE_FETCH_TIMEOUT_MS = 10000;
const FUT_PRICE_RETRY_DELAY_MS = 900;
const FUT_PLAYERS_FETCH_TIMEOUT_MS = 12000;
const FUT_PLAYERS_MIN_GAP_MS = 700;
const FUT_PLAYERS_MAX_PAGES = 5;
const FUT_PLAYERS_PRICE_GTE = 200;
const FUT_PLAYERS_ALLOWED_FILTERS = new Set([
  "club_id",
  "current_price__lte",
  "league_id",
  "nation_id",
  "overall__gte",
  "overall__lte",
  "price__gte",
  "price__lte",
  "rarity_id",
]);
import { solveLocalSbc } from "./solver/local-ai.js?v=2026-09-05a";
import {
  initUpdateChecker,
  handleUpdateStatusMessage,
} from "./update-checker.js";

initUpdateChecker();

console.log("[EA Data] Background loaded", {
  mode: "direct",
  workerAvailable: typeof Worker !== "undefined",
});

// Help diagnose MV3 service worker terminations/crashes.
try {
  self.addEventListener("unhandledrejection", (event) => {
    console.log("[EA Data] Background unhandledrejection", {
      reason: String(event?.reason?.message || event?.reason || ""),
    });
  });
  self.addEventListener("error", (event) => {
    console.log("[EA Data] Background error", {
      message: String(event?.message || ""),
      filename: event?.filename || null,
      lineno: event?.lineno || null,
      colno: event?.colno || null,
    });
  });
} catch {}

const handleSolverRequest = async (message, sendResponse) => {
  const payload = message?.payload || null;
  const workerType = payload?.type ?? "SOLVE";
  const workerPayload = payload?.payload ?? payload ?? null;
  try {
    if (workerType === "SOLVE" && !(await verifyAuth()).authenticated) {
      sendResponse({
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "Sign in to FodderFlow to use the solver.",
        },
      });
      return;
    }
    if (workerType === "INIT") {
      sendResponse({
        ok: true,
        data: {
          ready: true,
          mode: "local-background",
          engine: "heuristic+glpk",
          apiFree: true,
        },
      });
      return;
    }
    if (workerType === "SOLVE") {
      const result = await solveLocalSbc(workerPayload || {});
      sendResponse({ ok: true, data: result });
      return;
    }
    sendResponse({ ok: true, data: { ok: true } });
  } catch (error) {
    sendResponse({
      ok: false,
      error: {
        code: "SOLVER_BRIDGE_FAILED",
        message: error?.message || "Solver bridge failed",
      },
    });
  }
};

const handleBridgeInjectRequest = async (message, sender, sendResponse) => {
  const path = message?.payload?.path || "page/ea-data-bridge.js";
  const tabId = sender?.tab?.id;
  const frameId =
    Number.isInteger(sender?.frameId) && sender.frameId >= 0
      ? sender.frameId
      : 0;
  const senderUrl = String(
    sender?.tab?.url || sender?.url || message?.payload?.href || "",
  );

  try {
    if (tabId == null) {
      throw new Error("Missing sender tab id");
    }
    if (!ALLOWED_BRIDGE_INJECT_PATHS.has(path)) {
      throw new Error("Bridge path not allowed");
    }
    if (frameId !== 0) {
      throw new Error("Bridge injection only allowed in top frame");
    }
    if (!EA_WEBAPP_URL_RE.test(senderUrl)) {
      throw new Error("Bridge injection not allowed for this page");
    }
    if (!chrome?.scripting?.executeScript) {
      throw new Error("chrome.scripting.executeScript is unavailable");
    }
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [path],
      world: "MAIN",
    });
    sendResponse({
      ok: true,
      data: {
        injected: true,
        path,
        tabId,
        frameId: 0,
        senderUrl: senderUrl || null,
      },
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: {
        code: "PAGE_BRIDGE_INJECT_FAILED",
        message: error?.message || String(error),
        path,
        tabId: tabId ?? null,
        frameId,
        senderUrl: senderUrl || null,
      },
    });
  }
};

const futPriceCache = new Map();
let futPriceQueue = Promise.resolve();
let futPriceLastFetchAt = 0;
let futPlayersQueue = Promise.resolve();
let futPlayersLastFetchAt = 0;

const normalizePriceIds = (ids) => {
  const source = Array.isArray(ids) ? ids : [];
  const normalized = [];
  const seen = new Set();
  for (const raw of source) {
    const text = String(raw ?? "").trim();
    if (!text || seen.has(text)) continue;
    if (!/^\d+$/.test(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= FUT_PRICE_MAX_IDS_PER_REQUEST) break;
  }
  return normalized;
};

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const paceFutPriceFetch = async () => {
  const waitMs = futPriceLastFetchAt + FUT_PRICE_MIN_GAP_MS - Date.now();
  if (waitMs > 0) await delayMs(waitMs);
  futPriceLastFetchAt = Date.now();
};

const paceFutPlayersFetch = async () => {
  const waitMs = futPlayersLastFetchAt + FUT_PLAYERS_MIN_GAP_MS - Date.now();
  if (waitMs > 0) await delayMs(waitMs);
  futPlayersLastFetchAt = Date.now();
};

const markFutPriceBatchMissing = (ids, reason = null) => {
  const now = Date.now();
  for (const id of ids || []) {
    futPriceCache.set(String(id), {
      eaId: String(id),
      price: null,
      missing: true,
      error: reason ? String(reason) : null,
      cachedAt: now,
    });
  }
};

const fetchFutPriceBatchOnce = async (ids) => {
  await paceFutPriceFetch();
  const url = new URL(FUT_PRICE_API_URL);
  url.searchParams.set("ids", ids.join(","));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, FUT_PRICE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok)
    throw new Error(`FUT.GG price request failed (${response.status})`);
  const json = await response.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  const now = Date.now();
  const returnedIds = new Set();
  for (const row of rows) {
    const id = String(row?.eaId ?? "").trim();
    if (!id) continue;
    returnedIds.add(id);
    futPriceCache.set(id, {
      eaId: id,
      platform: row?.platform ?? null,
      price: Number.isFinite(Number(row?.price)) ? Number(row.price) : null,
      isExtinct: Boolean(row?.isExtinct),
      isSbc: Boolean(row?.isSbc),
      isObjective: Boolean(row?.isObjective),
      isUntradeable: Boolean(row?.isUntradeable),
      priceUpdatedAt: row?.priceUpdatedAt ?? null,
      cachedAt: now,
    });
  }
  for (const id of ids) {
    if (!returnedIds.has(String(id))) {
      futPriceCache.set(id, {
        eaId: id,
        price: null,
        missing: true,
        cachedAt: now,
      });
    }
  }
};

const fetchFutPriceBatch = async (ids) => {
  try {
    await fetchFutPriceBatchOnce(ids);
    return { ok: true, ids };
  } catch (firstError) {
    try {
      await delayMs(FUT_PRICE_RETRY_DELAY_MS);
      await fetchFutPriceBatchOnce(ids);
      return { ok: true, ids, retried: true };
    } catch (secondError) {
      const message =
        secondError?.name === "AbortError"
          ? "FUT.GG price request timed out"
          : secondError?.message || firstError?.message || "FUT.GG price request failed";
      markFutPriceBatchMissing(ids, message);
      return { ok: false, ids, error: message };
    }
  }
};

const handlePriceRequest = (message, sendResponse) => {
  const ids = normalizePriceIds(message?.payload?.ids);
  const requestId = message?.payload?.requestId ?? null;
  const now = Date.now();
  const missing = ids.filter((id) => {
    const cached = futPriceCache.get(id);
    const cachedAt = Number(cached?.cachedAt) || 0;
    return !cached || now - cachedAt > FUT_PRICE_CACHE_TTL_MS;
  });
  console.log("[EA Data] Price request received", {
    requestId,
    requestedCount: ids.length,
    missingCount: missing.length,
  });

  futPriceQueue = futPriceQueue
    .catch(() => {})
    .then(async () => {
      const errors = [];
      for (let index = 0; index < missing.length; index += FUT_PRICE_BATCH_SIZE) {
        const batch = missing.slice(index, index + FUT_PRICE_BATCH_SIZE);
        if (!batch.length) continue;
        console.log("[EA Data] Price batch start", {
          requestId,
          batchIndex: Math.floor(index / FUT_PRICE_BATCH_SIZE) + 1,
          batchCount: batch.length,
          ids: batch,
        });
        const batchResult = await fetchFutPriceBatch(batch);
        console.log("[EA Data] Price batch done", {
          requestId,
          ok: Boolean(batchResult?.ok),
          batchCount: batch.length,
          error: batchResult?.error ?? null,
        });
        if (!batchResult?.ok) {
          errors.push({
            ids: batch,
            message: batchResult?.error ?? "FUT.GG price request failed",
          });
        }
      }
      const prices = {};
      for (const id of ids) {
        const cached = futPriceCache.get(id);
        if (cached) prices[id] = cached;
      }
      console.log("[EA Data] Price request complete", {
        requestId,
        requestedCount: ids.length,
        returnedCount: Object.keys(prices).length,
        errorCount: errors.length,
      });
      sendResponse({
        ok: true,
        data: {
          prices,
          requestedCount: ids.length,
          fetchedCount: missing.length,
          errorCount: errors.length,
          errors,
          cacheTtlMs: FUT_PRICE_CACHE_TTL_MS,
        },
      });
    })
    .catch((error) => {
      console.log("[EA Data] Price request failed", {
        requestId,
        message: error?.message || String(error),
      });
      sendResponse({
        ok: false,
        error: {
          code: "FUT_PRICE_REQUEST_FAILED",
          message: error?.message || "FUT.GG price request failed",
        },
      });
    });
};

const normalizeFutPlayersRequest = (payload = {}) => {
  const pagesRaw = Number(payload?.pages);
  const pages = Number.isFinite(pagesRaw)
    ? Math.max(1, Math.min(FUT_PLAYERS_MAX_PAGES, Math.floor(pagesRaw)))
    : 2;
  const rarityIds = Array.isArray(payload?.rarityIds)
    ? payload.rarityIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 6)
    : [];
  const priceGteRaw = Number(payload?.priceGte);
  const priceGte = Number.isFinite(priceGteRaw)
    ? Math.max(0, Math.floor(priceGteRaw))
    : FUT_PLAYERS_PRICE_GTE;
  const sorts = String(payload?.sorts || "current_price");
  const rawFilters =
    payload?.filters && typeof payload.filters === "object"
      ? payload.filters
      : {};
  const filters = {};
  for (const [key, value] of Object.entries(rawFilters)) {
    if (!FUT_PLAYERS_ALLOWED_FILTERS.has(key)) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    filters[key] = Math.floor(numeric);
  }
  return { pages, rarityIds, priceGte, sorts, filters };
};

const fetchFutPlayersPage = async ({
  page,
  rarityId,
  priceGte,
  sorts,
  filters = {},
}) => {
  await paceFutPlayersFetch();
  const url = new URL(FUT_PLAYERS_API_URL);
  url.searchParams.set("page", String(page));
  if (rarityId != null) url.searchParams.set("rarity_id", String(rarityId));
  url.searchParams.set("price__gte", String(priceGte));
  for (const [key, value] of Object.entries(filters)) {
    if (key === "rarity_id" || key === "price__gte") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("sorts", sorts);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, FUT_PLAYERS_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok)
    throw new Error(`FUT.GG players request failed (${response.status})`);
  return response.json();
};

const handleFutPlayersRequest = (message, sendResponse) => {
  const requestId = message?.payload?.requestId ?? null;
  const params = normalizeFutPlayersRequest(message?.payload ?? {});
  console.log("[EA Data] FUT.GG players request received", {
    requestId,
    pages: params.pages,
    rarityIds: params.rarityIds,
    priceGte: params.priceGte,
    sorts: params.sorts,
    filters: params.filters,
  });

  futPlayersQueue = futPlayersQueue
    .catch(() => {})
    .then(async () => {
      const rows = [];
      const errors = [];
      const rarityIds = params.rarityIds.length ? params.rarityIds : [null];
      for (const rarityId of rarityIds) {
        for (let page = 1; page <= params.pages; page += 1) {
          try {
            const json = await fetchFutPlayersPage({
              page,
              rarityId,
              priceGte: params.priceGte,
              sorts: params.sorts,
              filters: params.filters,
            });
            const pageRows = Array.isArray(json?.data) ? json.data : [];
            rows.push(...pageRows);
            console.log("[EA Data] FUT.GG players page", {
              requestId,
              rarityId,
              page,
              count: pageRows.length,
            });
            if (!pageRows.length) break;
          } catch (error) {
            errors.push({
              rarityId,
              page,
              message: error?.message || String(error),
            });
            break;
          }
        }
      }
      sendResponse({
        ok: true,
        data: {
          rows,
          requestedRarityIds: params.rarityIds,
          pages: params.pages,
          priceGte: params.priceGte,
          sorts: params.sorts,
          filters: params.filters,
          rowCount: rows.length,
          errorCount: errors.length,
          errors,
        },
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: {
          code: "FUTGG_PLAYERS_REQUEST_FAILED",
          message: error?.message || "FUT.GG players request failed",
        },
      });
    });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FF_OPEN_SIGNUP") {
    chrome.tabs.create({ url: "https://fodderflow.shant0.xyz/?auth=signup" });
    return false;
  }
  if (["FF_AUTH_STATUS", "FF_AUTH_LOGIN", "FF_AUTH_SIGNUP", "FF_AUTH_LOGOUT"].includes(message?.type)) {
    handleAuthMessage(message, sendResponse);
    return true;
  }
  if (
    message?.type === "FF_GET_UPDATE_STATUS" ||
    message?.type === "FF_FORCE_UPDATE_CHECK"
  ) {
    handleUpdateStatusMessage(message, sendResponse);
    return true;
  }
  if (message?.type === "FF_OPEN_UPDATE_LINK") {
    const url = message?.url || "https://github.com/shantocode/FodderFlow/releases/latest";
    chrome.tabs.create({ url });
    return false;
  }
  if (message?.type === BRIDGE_INJECT_REQUEST) {
    handleBridgeInjectRequest(message, sender, sendResponse);
    return true;
  }
  if (message?.type === PRICE_BRIDGE_REQUEST) {
    handlePriceRequest(message, sendResponse);
    return true;
  }
  if (message?.type === FUTGG_PLAYERS_BRIDGE_REQUEST) {
    handleFutPlayersRequest(message, sendResponse);
    return true;
  }
  if (!message || message.type !== SOLVER_BRIDGE_REQUEST) return false;
  console.log("[EA Data] Background request", {
    type: message?.payload?.type ?? null,
    debug: message?.payload?.payload?.debug ?? null,
  });
  handleSolverRequest(message, sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== SOLVER_PORT_NAME) return;

  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== WORKER_RESPONSE) return;
    const requestId = msg.requestId ?? null;
    const workerType = msg.workerType ?? "SOLVE";
    const workerPayload = msg.payload ?? null;
    if (!requestId) return;

    handleSolverRequest(
      { payload: { type: workerType, payload: workerPayload } },
      (response) => {
        try {
          port.postMessage({
            type: WORKER_RESPONSE,
            requestId,
            ...(response || {}),
          });
        } catch {}
      },
    );
  });
});
