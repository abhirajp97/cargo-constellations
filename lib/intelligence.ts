export type SeaIceSnapshot = {
  observedAt: string;
  source: string;
  thresholdPercent: number;
  points: Array<[number, number, number]>;
};

export type PiracyIncident = {
  id: string;
  occurredAt: string | null;
  coords: [number, number];
  category: "attempted" | "boarded" | "fired-upon" | "hijacked" | "suspicious" | "reported";
  narrative: string;
};

export type PiracySnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  incidents: PiracyIncident[];
};

export type CanalAdvisory = {
  id: string;
  subject: string;
  category: "draft" | "outage" | "navigation" | "operations" | "booking";
  url: string;
};

export type CanalSnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  advisories: CanalAdvisory[];
};

export type CommodityPrice = {
  id: string;
  label: string;
  unit: string;
  month: string;
  value: number;
  changePercent: number | null;
  series: Array<{ month: string; value: number }>;
};

export type CommoditySnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  cadence: "monthly";
  commodities: CommodityPrice[];
};

export type SarDetection = {
  date: string;
  lat: number;
  lon: number;
  detections: number;
};

export type SarSnapshot = {
  observedAt: string;
  dateRange: string;
  source: string;
  filter: "unmatched-with-ais";
  detections: SarDetection[];
};

export type WorldWakeCell = {
  date: string;
  lat: number;
  lon: number;
  intensity: number;
};

export type WorldWakeSnapshot = {
  observedAt: string;
  dateRange: string;
  availableThrough: string;
  delayDays: 4;
  source: string;
  resolution: "sampled-heatmap";
  filter: "cargo-and-carrier";
  cells: WorldWakeCell[];
};

export type DelayedVoyagePoint = {
  observedAt: string;
  lat: number;
  lon: number;
};

export type DelayedVoyage = {
  vesselId: string;
  mmsi?: string;
  imo?: string;
  name?: string;
  vesselType?: string;
  corridorId?: string;
  corridorLabel?: string;
  points: DelayedVoyagePoint[];
  distanceNm: number;
};

export type DelayedVoyageCorridor = {
  id: string;
  label: string;
  focus: [number, number];
  rows: number;
  identifiedVessels: number;
  qualifyingVessels: number;
  shown: number;
  status: "live" | "error";
  error?: string;
};

export type DelayedVoyagePilot = {
  observedAt: string;
  dateRange: string;
  region: string;
  source: string;
  caveat: string;
  windowDays: number;
  corridors: DelayedVoyageCorridor[];
  verdict: "pass" | "fail";
  rows: number;
  identifiedVessels: number;
  qualifyingVessels: number;
  candidates: DelayedVoyage[];
};

export type StaticIntelligence = {
  seaIce: SeaIceSnapshot;
  piracy: PiracySnapshot;
  canal: CanalSnapshot;
  commodities: CommoditySnapshot;
};

export async function fetchStaticIntelligence(): Promise<StaticIntelligence> {
  const [seaIce, piracy, canal, commodities] = await Promise.all([
    fetch("/sea-ice.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Sea ice unavailable"))),
    fetch("/piracy-incidents.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Piracy incidents unavailable"))),
    fetch("/canal-advisories.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Canal advisories unavailable"))),
    fetch("/commodity-prices.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Commodity prices unavailable"))),
  ]);
  return { seaIce, piracy, canal, commodities } as StaticIntelligence;
}

function relayHttpBase(websocketUrl: string) {
  const relay = new URL(websocketUrl);
  relay.protocol = relay.protocol === "wss:" ? "https:" : "http:";
  relay.pathname = "";
  relay.search = "";
  relay.hash = "";
  return relay.toString().replace(/\/$/, "");
}

export async function fetchSarDetections(websocketUrl: string): Promise<SarSnapshot> {
  const response = await fetch(`${relayHttpBase(websocketUrl)}/api/sar`);
  if (!response.ok) throw new Error(response.status === 503 ? "GFW token not configured" : "SAR source unavailable");
  return response.json() as Promise<SarSnapshot>;
}

export async function fetchWorldWake(websocketUrl: string): Promise<WorldWakeSnapshot> {
  const base = relayHttpBase(websocketUrl);
  const response = await fetch(`${base}/api/world-wake`);
  if (!response.ok) throw new Error(response.status === 503 ? "GFW token not configured" : "World wake unavailable");
  const manifest = await response.json() as Omit<WorldWakeSnapshot, "cells"> & { zoom: number; tiles: Array<{ x: number; y: number; url: string }> };
  const tileResults = await Promise.allSettled(manifest.tiles.map(async (tile) => {
    const tileResponse = await fetch(`${base}${tile.url}`);
    if (!tileResponse.ok) throw new Error("World wake tile unavailable");
    const bitmap = await createImageBitmap(await tileResponse.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [] as WorldWakeCell[];
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const cells: WorldWakeCell[] = [];
    const scale = 2 ** manifest.zoom;
    const step = 10;
    for (let py = step / 2; py < canvas.height; py += step) {
      for (let px = step / 2; px < canvas.width; px += step) {
        const index = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const intensity = alpha / 255 * ((red + green + blue) / (255 * 3));
        if (alpha < 8 || intensity < 0.015) continue;
        const worldX = tile.x + px / canvas.width;
        const worldY = tile.y + py / canvas.height;
        const lon = worldX / scale * 360 - 180;
        const mercator = Math.PI - 2 * Math.PI * worldY / scale;
        const lat = 180 / Math.PI * Math.atan(Math.sinh(mercator));
        cells.push({ date: manifest.dateRange, lat, lon, intensity });
      }
    }
    return cells;
  }));
  const tileCells = tileResults
    .filter((result): result is PromiseFulfilledResult<WorldWakeCell[]> => result.status === "fulfilled")
    .map((result) => result.value);
  if (tileCells.length === 0) throw new Error("World wake tiles unavailable");
  const rankedCells = tileCells.flat().sort((a, b) => b.intensity - a.intensity).slice(0, 3_600);
  const peakIntensity = rankedCells[0]?.intensity || 1;
  return {
    observedAt: manifest.observedAt,
    dateRange: manifest.dateRange,
    availableThrough: manifest.availableThrough,
    delayDays: manifest.delayDays,
    source: manifest.source,
    resolution: manifest.resolution,
    filter: manifest.filter,
    cells: rankedCells.map((cell) => ({
      ...cell,
      intensity: Math.min(1, Math.sqrt(cell.intensity / peakIntensity)),
    })),
  };
}

export async function fetchDelayedVoyagePilot(websocketUrl: string): Promise<DelayedVoyagePilot> {
  const base = relayHttpBase(websocketUrl);
  const manifestResponse = await fetch(`${base}/api/gfw-voyage-probe`);
  if (!manifestResponse.ok) throw new Error(manifestResponse.status === 503 ? "GFW token not configured" : "Delayed voyage pilot unavailable");
  const manifest = await manifestResponse.json() as Omit<DelayedVoyagePilot, "verdict" | "rows" | "identifiedVessels" | "qualifyingVessels" | "candidates" | "corridors"> & {
    corridorSpecs: Array<Pick<DelayedVoyageCorridor, "id" | "label" | "focus">>;
  };
  const corridorResults: DelayedVoyagePilot[] = [];
  const corridors: DelayedVoyageCorridor[] = [];
  for (const corridor of manifest.corridorSpecs) {
    try {
      const response = await fetch(`${base}/api/gfw-voyage-probe?corridor=${encodeURIComponent(corridor.id)}`);
      if (!response.ok) throw new Error(`report failed (${response.status})`);
      const result = await response.json() as DelayedVoyagePilot;
      corridorResults.push(result);
      corridors.push(result.corridors[0]);
    } catch (error) {
      corridors.push({ ...corridor, rows: 0, identifiedVessels: 0, qualifyingVessels: 0, shown: 0, status: "error", error: error instanceof Error ? error.message : "Corridor unavailable" });
    }
  }
  const candidates = corridorResults.flatMap((result) => result.candidates)
    .sort((a, b) => b.distanceNm - a.distanceNm || b.points.length - a.points.length)
    .slice(0, 180);
  if (candidates.length === 0) throw new Error("Delayed voyage corridors unavailable");
  return {
    ...manifest,
    verdict: candidates.length >= 20 && corridors.filter((corridor) => corridor.status === "live").length >= 3 ? "pass" : "fail",
    rows: corridorResults.reduce((sum, result) => sum + result.rows, 0),
    identifiedVessels: corridorResults.reduce((sum, result) => sum + result.identifiedVessels, 0),
    qualifyingVessels: corridorResults.reduce((sum, result) => sum + result.qualifyingVessels, 0),
    corridors,
    candidates,
  };
}

export type PersistedDelayedVoyagePilot = {
  pilot: DelayedVoyagePilot;
  persistedAt: string;
};

export async function fetchPersistedDelayedVoyagePilot(): Promise<PersistedDelayedVoyagePilot> {
  const response = await fetch("/api/voyage-snapshots", { cache: "no-store" });
  if (!response.ok) throw new Error("Durable voyage archive unavailable");
  const result = await response.json() as { snapshot: DelayedVoyagePilot | null; persistedAt: string | null };
  if (!result.snapshot || !result.persistedAt) throw new Error("Durable voyage archive is empty");
  return { pilot: result.snapshot, persistedAt: result.persistedAt };
}

export async function persistDelayedVoyagePilot(pilot: DelayedVoyagePilot): Promise<string> {
  const response = await fetch("/api/voyage-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pilot),
  });
  if (!response.ok) throw new Error("Voyage snapshot could not be persisted");
  const result = await response.json() as { persistedAt: string };
  return result.persistedAt;
}
