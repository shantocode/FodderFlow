import { solveLocalSbc } from "./local-ai.js";

const WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";

const reply = (requestId, ok, data, error) => {
  self.postMessage({ type: WORKER_RESPONSE, requestId, ok, data, error });
};

self.addEventListener("message", async (event) => {
  const { type, requestId, payload } = event.data || {};
  if (!type || !requestId) return;

  if (type === "INIT") {
    return reply(requestId, true, {
      ready: true,
      mode: "local-worker",
      engine: "heuristic+glpk",
      apiFree: true,
    });
  }

  if (type === "SOLVE") {
    try {
      const result = await solveLocalSbc(payload || {});
      return reply(requestId, true, result);
    } catch (error) {
      return reply(requestId, false, null, {
        code: "SOLVER_FAILED",
        message: error?.message || "Solver failed",
      });
    }
  }

  return reply(requestId, true, { ok: true });
});
