import GLPK from "./glpk.js";
import { buildSolverContext, solveSquad } from "./solver.js";
import { compileConstraintSet, toNumber } from "./constraint-compiler.js";

const FAST_BUDGET_MS = 2200;
const MIP_PLAYER_LIMIT = 900;
let glpkPromise = null;

const isConcept = (player) =>
  Boolean(
    player?.isConcept ||
      player?.concept ||
      player?.isConceptPlayer ||
      String(player?.pile ?? "").toLowerCase() === "concept",
  );

const playerId = (player) => player?.id ?? player?.itemId ?? player?.itemGuid;

const forceOwnedOnly = (payload = {}) => ({
  ...payload,
  players: (Array.isArray(payload?.players) ? payload.players : []).filter(
    (player) => playerId(player) != null && !isConcept(player),
  ),
  filters: {
    ...(payload?.filters && typeof payload.filters === "object"
      ? payload.filters
      : {}),
    allowConceptPlayers: false,
  },
});

const annotate = (result, engine, extra = {}) => ({
  ...result,
  engine,
  local: true,
  apiFree: true,
  stats: {
    ...(result?.stats || {}),
    engine,
    local: true,
    apiFree: true,
    ...extra,
  },
});

const getSquadSize = (context, compiled) =>
  Math.max(
    1,
    Math.min(
      context.players.length,
      toNumber(compiled?.summary?.squadSizeTarget) ??
        toNumber(context?.requiredPlayers) ??
        11,
    ),
  );

const getCandidateScore = (player) => {
  const rating = toNumber(player?.rating) ?? 0;
  let score = rating * 100;
  if (player?.isTradeable || player?.isTradable) score += 250;
  if (player?.isSpecial && !player?.isTotwOrTots) score += 180;
  if (player?.isEvolution) score += 300;
  if (player?.isDuplicate || player?.isUnassigned) score -= 80;
  if (player?.isStorage) score -= 35;
  return score;
};

const trimMipCandidates = (players) => {
  if (players.length <= MIP_PLAYER_LIMIT) return players;
  const lowCost = players
    .slice()
    .sort((a, b) => getCandidateScore(a) - getCandidateScore(b))
    .slice(0, Math.floor(MIP_PLAYER_LIMIT * 0.72));
  const highRated = players
    .slice()
    .sort((a, b) => (toNumber(b?.rating) ?? 0) - (toNumber(a?.rating) ?? 0))
    .slice(0, Math.floor(MIP_PLAYER_LIMIT * 0.18));
  const special = players
    .filter(
      (player) =>
        player?.isSpecial ||
        player?.isTotwOrTots ||
        player?.isIcon ||
        player?.isHero,
    )
    .slice(0, Math.floor(MIP_PLAYER_LIMIT * 0.1));
  return [...new Map([...lowCost, ...highRated, ...special].map((p) => [String(playerId(p)), p])).values()]
    .slice(0, MIP_PLAYER_LIMIT);
};

const bound = (glpk, op, target) => {
  if (op === "max") return { type: glpk.GLP_UP, lb: 0, ub: target };
  if (op === "exact") return { type: glpk.GLP_FX, lb: target, ub: target };
  return { type: glpk.GLP_LO, lb: target, ub: 0 };
};

const matchesIdentity = (player, type, values) => {
  const wanted = new Set((values || []).map(String));
  if (!wanted.size) return false;
  if (type === "nation_id") return wanted.has(String(player?.nationId));
  if (type === "league_id") return wanted.has(String(player?.leagueId));
  if (type === "club_id") return wanted.has(String(player?.teamId ?? player?.clubId));
  return false;
};

const buildMipModel = (glpk, context, compiled) => {
  const candidates = trimMipCandidates(context.players);
  const names = candidates.map((_, index) => `p${index}`);
  const squadSize = getSquadSize(context, compiled);
  const subjectTo = [
    {
      name: "squad_size",
      vars: names.map((name) => ({ name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: squadSize, ub: squadSize },
    },
  ];

  const ratingTarget = toNumber(compiled?.summary?.teamRatingTarget);
  if (ratingTarget != null) {
    subjectTo.push({
      name: "rating_floor",
      vars: candidates.map((player, index) => ({
        name: names[index],
        coef: toNumber(player?.rating) ?? 0,
      })),
      // This is a safe presolver hint. The existing solver performs FC's exact
      // adjusted-rating calculation before a squad can be returned as solved.
      bnds: {
        type: glpk.GLP_LO,
        lb: Math.max(0, ratingTarget - 0.5) * squadSize,
        ub: 0,
      },
    });
  }

  for (const constraint of compiled?.constraints || []) {
    if (!["nation_id", "league_id", "club_id"].includes(constraint.type)) continue;
    const target = toNumber(constraint.target ?? constraint.count);
    if (target == null) continue;
    subjectTo.push({
      name: constraint.id,
      vars: candidates.map((player, index) => ({
        name: names[index],
        coef: matchesIdentity(player, constraint.type, constraint.values) ? 1 : 0,
      })),
      bnds: bound(glpk, constraint.op, target),
    });
  }

  return {
    candidates,
    names,
    model: {
      name: "fodder_flow_local_sbc",
      objective: {
        direction: glpk.GLP_MIN,
        name: "fodder_cost",
        vars: candidates.map((player, index) => ({
          name: names[index],
          coef: getCandidateScore(player),
        })),
      },
      subjectTo,
      binaries: names,
    },
  };
};

const runMipFallback = async (payload, context) => {
  glpkPromise ||= GLPK();
  const glpk = await glpkPromise;
  const compiled = compileConstraintSet(context.requirementsNormalized || [], {
    fallbackSquadSize: context.requiredPlayers ?? 11,
  });
  const { candidates, names, model } = buildMipModel(glpk, context, compiled);
  if (candidates.length < getSquadSize(context, compiled)) return null;

  const mip = await glpk.solve(model, {
    msglev: glpk.GLP_MSG_OFF,
    tmlim: 5,
    presol: true,
    mipgap: 0.02,
  });
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(mip?.result?.status)) return null;

  const selected = candidates.filter(
    (_, index) => (mip?.result?.vars?.[names[index]] ?? 0) > 0.5,
  );
  if (!selected.length) return null;

  const selectedIds = new Set(selected.map((player) => String(playerId(player))));
  const orderedPlayers = [
    ...selected,
    ...context.players.filter(
      (player) => !selectedIds.has(String(playerId(player))),
    ),
  ];
  const result = solveSquad(
    buildSolverContext({
      ...payload,
      players: orderedPlayers,
      optimize: {
        ...(payload?.optimize || {}),
        restartTimeBudgetMs: Math.max(
          6500,
          toNumber(payload?.optimize?.restartTimeBudgetMs) ?? 0,
        ),
      },
    }),
  );
  return annotate(result, "local-glpk+heuristic", {
    mipCandidateCount: candidates.length,
    mipSelectedCount: selected.length,
  });
};

export const solveLocalSbc = async (rawPayload = {}) => {
  const payload = forceOwnedOnly(rawPayload);
  const fastContext = buildSolverContext({
    ...payload,
    optimize: {
      ...(payload?.optimize || {}),
      restartTimeBudgetMs: Math.min(
        FAST_BUDGET_MS,
        Math.max(500, toNumber(payload?.optimize?.restartTimeBudgetMs) ?? FAST_BUDGET_MS),
      ),
      fallbackTimeBudgetMs: Math.min(
        450,
        Math.max(0, toNumber(payload?.optimize?.fallbackTimeBudgetMs) ?? 450),
      ),
    },
  });
  const fastResult = solveSquad(fastContext);
  if (fastResult?.solved || fastResult?.stats?.solved) {
    return annotate(fastResult, "local-heuristic");
  }

  try {
    const mipResult = await runMipFallback(payload, fastContext);
    if (mipResult?.solved || mipResult?.stats?.solved) return mipResult;
    if (mipResult) return mipResult;
  } catch (error) {
    // GLPK is an accelerator, not a single point of failure.
    const fallback = solveSquad(buildSolverContext(payload));
    return annotate(fallback, "local-heuristic-fallback", {
      mipError: error?.message || String(error),
    });
  }

  return annotate(fastResult, "local-heuristic");
};

