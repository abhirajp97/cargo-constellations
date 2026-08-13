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
  points: GfwProbePoint[];
  distanceNm: number;
};

export type GfwProbeSummary = {
  verdict: "pass" | "fail";
  criteria: {
    minimumVessels: 20;
    minimumOrderedPoints: 6;
  };
  rows: number;
  identifiedVessels: number;
  qualifyingVessels: number;
  candidates: GfwProbeCandidate[];
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

export function summarizeGfwVoyageProbe(rows: GfwPresenceRow[]): GfwProbeSummary {
  const groups = new Map<string, { identity: Omit<GfwProbeCandidate, "points" | "distanceNm">; points: GfwProbePoint[] }>();

  for (const row of rows) {
    const vesselId = text(row, "vesselId", "vessel_id");
    const observedAt = text(row, "date", "timestamp", "entryTimestamp");
    const lat = number(row, "lat", "latitude");
    const lon = number(row, "lon", "longitude");
    if (!vesselId || !observedAt || lat === undefined || lon === undefined) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number.isNaN(Date.parse(observedAt.replace(" ", "T") + (observedAt.includes("T") ? "" : "Z")))) continue;

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
    const ordered = points
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
      .filter((point, index, all) => index === 0 || point.observedAt !== all[index - 1].observedAt || point.lat !== all[index - 1].lat || point.lon !== all[index - 1].lon);
    let travelled = 0;
    for (let index = 1; index < ordered.length; index += 1) travelled += distanceNm(ordered[index - 1], ordered[index]);
    return { ...identity, points: ordered, distanceNm: Math.round(travelled * 10) / 10 };
  }).filter((candidate) => candidate.points.length >= 6 && candidate.distanceNm >= 5)
    .sort((a, b) => b.points.length - a.points.length || b.distanceNm - a.distanceNm);

  return {
    verdict: candidates.length >= 20 ? "pass" : "fail",
    criteria: { minimumVessels: 20, minimumOrderedPoints: 6 },
    rows: rows.length,
    identifiedVessels: groups.size,
    qualifyingVessels: candidates.length,
    candidates: candidates.slice(0, 180),
  };
}
