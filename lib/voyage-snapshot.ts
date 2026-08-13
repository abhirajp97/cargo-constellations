import type { DelayedVoyage, DelayedVoyageCorridor, DelayedVoyagePilot } from "./intelligence";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function boundedText(value: unknown, maximumLength: number, required: true): string | null;
function boundedText(value: unknown, maximumLength: number, required?: false): string | undefined;
function boundedText(value: unknown, maximumLength: number, required = false): string | null | undefined {
  if (typeof value !== "string") return required ? null : undefined;
  const text = value.trim().slice(0, maximumLength);
  return text || (required ? null : undefined);
}

function boundedCount(value: unknown) {
  return Math.min(10_000_000, Math.max(0, Math.floor(Number(value) || 0)));
}

function parseCorridor(value: unknown): DelayedVoyageCorridor | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = boundedText(candidate.id, 80, true);
  const label = boundedText(candidate.label, 120, true);
  const focus = Array.isArray(candidate.focus) ? candidate.focus : [];
  const lon = finiteNumber(focus[0], -180, 180);
  const lat = finiteNumber(focus[1], -90, 90);
  const status = candidate.status === "live" ? "live" : candidate.status === "error" ? "error" : null;
  if (!id || !label || lon === null || lat === null || !status) return null;
  return {
    id,
    label,
    focus: [lon, lat],
    rows: boundedCount(candidate.rows),
    identifiedVessels: boundedCount(candidate.identifiedVessels),
    qualifyingVessels: boundedCount(candidate.qualifyingVessels),
    shown: boundedCount(candidate.shown),
    status,
    error: boundedText(candidate.error, 200),
  };
}

function parseVoyage(value: unknown): DelayedVoyage | null {
  const candidate = record(value);
  if (!candidate) return null;
  const vesselId = boundedText(candidate.vesselId, 180, true);
  const points = Array.isArray(candidate.points) ? candidate.points.slice(0, 16).map((value) => {
    const point = record(value);
    if (!point) return null;
    const observedAt = boundedText(point.observedAt, 40, true);
    const lat = finiteNumber(point.lat, -90, 90);
    const lon = finiteNumber(point.lon, -180, 180);
    if (!observedAt || Number.isNaN(Date.parse(observedAt.replace(" ", "T") + (observedAt.includes("T") ? "" : "Z"))) || lat === null || lon === null) return null;
    return { observedAt, lat, lon };
  }).filter((point) => point !== null) : [];
  const distanceNm = finiteNumber(candidate.distanceNm, 0, 20_000);
  if (!vesselId || points.length < 2 || distanceNm === null) return null;
  return {
    vesselId,
    mmsi: boundedText(candidate.mmsi, 24),
    imo: boundedText(candidate.imo, 24),
    name: boundedText(candidate.name, 160),
    vesselType: boundedText(candidate.vesselType, 80),
    corridorId: boundedText(candidate.corridorId, 80),
    corridorLabel: boundedText(candidate.corridorLabel, 120),
    points,
    distanceNm,
  };
}

export function parseVoyageSnapshot(value: unknown): DelayedVoyagePilot {
  const candidate = record(value);
  if (!candidate) throw new Error("Snapshot must be an object");
  const observedAt = boundedText(candidate.observedAt, 40, true);
  const dateRange = boundedText(candidate.dateRange, 80, true);
  const region = boundedText(candidate.region, 160, true);
  const source = boundedText(candidate.source, 200, true);
  const caveat = boundedText(candidate.caveat, 600, true);
  const windowDays = finiteNumber(candidate.windowDays, 1, 31);
  const corridors = Array.isArray(candidate.corridors) ? candidate.corridors.slice(0, 10).map(parseCorridor).filter((item) => item !== null) : [];
  const candidates = Array.isArray(candidate.candidates) ? candidate.candidates.slice(0, 180).map(parseVoyage).filter((item) => item !== null) : [];
  if (!observedAt || Number.isNaN(Date.parse(observedAt)) || !dateRange || !region || !source || !caveat || windowDays === null || corridors.length === 0 || candidates.length === 0) {
    throw new Error("Snapshot is missing required voyage data");
  }
  return {
    observedAt,
    dateRange,
    region,
    source,
    caveat,
    windowDays,
    corridors,
    verdict: candidate.verdict === "pass" ? "pass" : "fail",
    rows: boundedCount(candidate.rows),
    identifiedVessels: boundedCount(candidate.identifiedVessels),
    qualifyingVessels: boundedCount(candidate.qualifyingVessels),
    candidates,
  };
}
