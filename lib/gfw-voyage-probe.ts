export type GfwPresenceRow = Record<string, unknown>;

export type GfwProbePoint = {
  observedAt: string;
  lat: number;
  lon: number;
};

export type GfwProbeCandidate = {
  vesselId: string;
  mmsi?: string;
  imo?: string;
  name?: string;
  vesselType?: string;
  corridorId?: string;
  corridorLabel?: string;
  points: GfwProbePoint[];
  distanceNm: number;
};

export type GfwProbeSummary = {
  verdict: "pass" | "fail";
  criteria: {
    minimumVessels: number;
    minimumOrderedPoints: number;
    minimumDistanceNm: number;
  };
  rows: number;
  identifiedVessels: number;
  qualifyingVessels: number;
  candidates: GfwProbeCandidate[];
};

export type GfwProbeOptions = {
  minimumVessels?: number;
  minimumOrderedPoints?: number;
  minimumDistanceNm?: number;
  maximumSpeedKn?: number;
  limit?: number;
  rankBy?: "coverage" | "distance";
};

function text(row: GfwPresenceRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function number(row: GfwPresenceRow, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function distanceNm(a: GfwProbePoint, b: GfwProbePoint) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function parsedTime(value: string) {
  return Date.parse(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
}

export function summarizeGfwVoyageProbe(rows: GfwPresenceRow[], options: GfwProbeOptions = {}): GfwProbeSummary {
  const minimumVessels = options.minimumVessels ?? 20;
  const minimumOrderedPoints = options.minimumOrderedPoints ?? 6;
  const minimumDistanceNm = options.minimumDistanceNm ?? 5;
  const maximumSpeedKn = options.maximumSpeedKn ?? 55;
  const limit = options.limit ?? 180;
  const groups = new Map<string, { identity: Omit<GfwProbeCandidate, "points" | "distanceNm">; points: GfwProbePoint[] }>();

  for (const row of rows) {
    const vesselId = text(row, "vesselId", "vessel_id");
    const observedAt = text(row, "date", "timestamp", "entryTimestamp");
    const lat = number(row, "lat", "latitude");
    const lon = number(row, "lon", "longitude");
    if (!vesselId || !observedAt || lat === undefined || lon === undefined) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number.isNaN(parsedTime(observedAt))) continue;

    const group = groups.get(vesselId) ?? {
      identity: {
        vesselId,
        mmsi: text(row, "mmsi"),
        imo: text(row, "imo"),
        name: text(row, "shipName", "ship_name", "name"),
        vesselType: text(row, "vesselType", "vessel_type"),
      },
      points: [],
    };
    group.points.push({ observedAt, lat, lon });
    groups.set(vesselId, group);
  }

  const candidates = [...groups.values()].map(({ identity, points }) => {
    const hourlyCells = new Map<string, GfwProbePoint[]>();
    for (const point of points) hourlyCells.set(point.observedAt, [...(hourlyCells.get(point.observedAt) ?? []), point]);
    const chronological = [...hourlyCells.entries()].sort(([a], [b]) => parsedTime(a) - parsedTime(b));
    const ordered: GfwProbePoint[] = [];
    for (const [, cells] of chronological) {
      const previous = ordered.at(-1);
      if (!previous) {
        ordered.push(cells[0]);
        continue;
      }
      const point = cells.sort((a, b) => distanceNm(previous, a) - distanceNm(previous, b))[0];
      const elapsedHours = (parsedTime(point.observedAt) - parsedTime(previous.observedAt)) / 3_600_000;
      if (elapsedHours <= 0 || distanceNm(previous, point) / elapsedHours > maximumSpeedKn) continue;
      ordered.push(point);
    }
    let travelled = 0;
    for (let index = 1; index < ordered.length; index += 1) travelled += distanceNm(ordered[index - 1], ordered[index]);
    return { ...identity, points: ordered, distanceNm: Math.round(travelled * 10) / 10 };
  }).filter((candidate) => candidate.points.length >= minimumOrderedPoints && candidate.distanceNm >= minimumDistanceNm)
    .sort(options.rankBy === "distance"
      ? (a, b) => b.distanceNm - a.distanceNm || b.points.length - a.points.length
      : (a, b) => b.points.length - a.points.length || b.distanceNm - a.distanceNm);

  return {
    verdict: candidates.length >= minimumVessels ? "pass" : "fail",
    criteria: { minimumVessels, minimumOrderedPoints, minimumDistanceNm },
    rows: rows.length,
    identifiedVessels: groups.size,
    qualifyingVessels: candidates.length,
    candidates: candidates.slice(0, limit),
  };
}
