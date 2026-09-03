const toNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const readStaticName = (raw) =>
  raw?._staticData?.name ??
  raw?._staticData?.knownAs ??
  raw?.name ??
  raw?.commonName ??
  null;

export const isConceptPlayer = (player) =>
  Boolean(
    player?.isConcept === true ||
      player?.concept === true ||
      player?.source === "concept" ||
      (typeof player?.id === "string" && player.id.startsWith("concept:")),
  );

export const normalizeConceptPlayer = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const rawId = raw.id ?? raw.definitionId ?? raw.assetId ?? raw._assetId;
  const conceptId = toNumber(raw.id) ?? toNumber(raw.definitionId) ?? rawId;
  const definitionId = toNumber(raw.definitionId) ?? toNumber(raw.id);
  const rating = toNumber(raw.rating) ?? toNumber(raw._rating);
  if (conceptId == null || definitionId == null || rating == null) return null;
  const possiblePositions = Array.isArray(raw.basePossiblePositions)
    ? raw.basePossiblePositions.slice()
    : [];
  const preferredPosition = raw.preferredPosition ?? null;
  const positionIds = possiblePositions.length
    ? possiblePositions
    : preferredPosition != null
      ? [preferredPosition]
      : [];

  return {
    id: `concept:${conceptId}`,
    conceptId,
    definitionId,
    assetId: raw.assetId ?? raw._assetId ?? null,
    rating,
    teamId: raw.teamId ?? null,
    leagueId: raw.leagueId ?? null,
    nationId: raw.nationId ?? null,
    rarityId: raw.rarityId ?? raw.rareflag ?? raw._rareflag ?? null,
    rarityName: raw.rarityName ?? null,
    preferredPositionId: preferredPosition,
    preferredPositionName: raw.preferredPositionName ?? preferredPosition,
    alternativePositionIds: positionIds,
    alternativePositionNames: raw.alternativePositionNames ?? positionIds,
    name: readStaticName(raw),
    commonName: readStaticName(raw),
    gender: raw.gender ?? null,
    groups: Array.isArray(raw.groups) ? raw.groups.slice() : [],
    subtype: raw.subtype ?? null,
    attributes: Array.isArray(raw.attributes) ? raw.attributes.slice() : [],
    isConcept: true,
    concept: true,
    isOwned: false,
    isTradeable: false,
    isUntradeable: true,
    isStorage: false,
    isUnassigned: false,
    source: "concept",
  };
};

export const mergeConceptCandidates = (ownedPlayers, conceptPlayers) => {
  const merged = [];
  const seenIds = new Set();
  const push = (player) => {
    if (!player || player.id == null) return;
    const key = String(player.id);
    if (seenIds.has(key)) return;
    seenIds.add(key);
    merged.push(player);
  };
  for (const player of Array.isArray(ownedPlayers) ? ownedPlayers : []) {
    push(player);
  }
  for (const player of Array.isArray(conceptPlayers) ? conceptPlayers : []) {
    push(player);
  }
  return merged;
};

export const getConceptUsageMetrics = (solution) => {
  const list = Array.isArray(solution) ? solution : [];
  const conceptPlayers = list.filter(isConceptPlayer);
  return {
    conceptCount: conceptPlayers.length,
    conceptDefinitionIds: conceptPlayers
      .map((player) => player?.definitionId ?? null)
      .filter((id) => id != null),
    conceptPlayerIds: conceptPlayers
      .map((player) => player?.id ?? null)
      .filter((id) => id != null),
  };
};
