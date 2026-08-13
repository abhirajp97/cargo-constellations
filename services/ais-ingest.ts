import WebSocket, { WebSocketServer } from "ws";
import mqtt, { type MqttClient } from "mqtt";
import { createServer } from "node:http";
import net from "node:net";
import { mergeAisEnvelope, type AisEnvelope, type Vessel } from "../lib/ais.js";
import { NmeaAisDecoder } from "../lib/nmea-ais.js";
import { summarizeGfwVoyageProbe, type GfwPresenceRow, type GfwProbeSummary } from "../lib/gfw-voyage-probe.js";

const upstreamUrl = "wss://stream.aisstream.io/v0/stream";
const fintrafficMqttUrl = "wss://meri.digitraffic.fi:443/mqtt";
const fintrafficLocationsUrl = "https://meri.digitraffic.fi/api/ais/v1/locations";
const fintrafficVesselsUrl = "https://meri.digitraffic.fi/api/ais/v1/vessels";
const fintrafficUserAgent = "cargo-constellations/0.1 (https://github.com/abhirajp97/cargo-constellations)";
const kystverketHost = process.env.KYSTVERKET_AIS_HOST ?? "153.44.253.27";
const kystverketPort = Number(process.env.KYSTVERKET_AIS_PORT ?? 5631);
const kystverketEnabled = process.env.KYSTVERKET_AIS_ENABLED !== "false";
const apiKey = process.env.AISSTREAM_API_KEY;
const gfwApiToken = process.env.GFW_API_TOKEN;
const downstreamPort = Number(process.env.PORT ?? process.env.AIS_RELAY_PORT ?? 8787);
const fullGlobe = process.env.AIS_FULL_GLOBE === "true";
const vesselTtlMs = 60 * 60 * 1000;
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));

const vessels = new Map<string, Vessel>();
const dirty = new Set<string>();
type SarDetection = { date: string; lat: number; lon: number; detections: number };
type SarSnapshot = { observedAt: string; dateRange: string; source: string; filter: "unmatched-with-ais"; detections: SarDetection[] };
let sarCache: { expiresAt: number; snapshot: SarSnapshot } | undefined;
type GfwVoyageProbe = GfwProbeSummary & {
  observedAt: string;
  dateRange: string;
  region: string;
  source: string;
  caveat: string;
  windowDays: number;
  corridors: GfwVoyageCorridor[];
};
type GfwVoyageCorridor = {
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
type GfwVoyageCorridorSpec = {
  id: string;
  label: string;
  focus: [number, number];
  coordinates: Array<[number, number]>;
};
const gfwVoyageCorridors: GfwVoyageCorridorSpec[] = [
  {
    id: "north-atlantic",
    label: "North Atlantic",
    focus: [-35, 43],
    coordinates: [[-75, 47], [-55, 52], [-25, 58], [8, 56], [8, 45], [-25, 40], [-55, 32], [-75, 35], [-75, 47]],
  },
  {
    id: "suez-arabian",
    label: "Europe · Suez · Arabian Sea",
    focus: [31, 24],
    coordinates: [[-10, 43], [20, 42], [34, 32], [45, 20], [73, 25], [73, 12], [50, 7], [38, 13], [27, 27], [10, 34], [-10, 32], [-10, 43]],
  },
  {
    id: "indian-malacca",
    label: "Indian Ocean · Malacca",
    focus: [72, 4],
    coordinates: [[35, 18], [60, 22], [82, 18], [106, 8], [106, -3], [80, 3], [55, -8], [35, -12], [35, 18]],
  },
  {
    id: "east-asia",
    label: "South China Sea · Japan",
    focus: [125, 21],
    coordinates: [[100, 10], [120, 35], [140, 48], [150, 45], [150, 35], [135, 25], [120, 5], [100, -5], [100, 10]],
  },
  {
    id: "panama-pacific",
    label: "Panama · Pacific approaches",
    focus: [-96, 11],
    coordinates: [[-130, 25], [-100, 20], [-78, 12], [-78, 0], [-105, 5], [-130, 10], [-130, 25]],
  },
];
let gfwVoyageProbeCache: { expiresAt: number; result: GfwVoyageProbe } | undefined;
const worldWakeTileCache = new Map<string, { expiresAt: number; contentType: string; data: Buffer }>();
let gfwReportQueue: Promise<void> = Promise.resolve();

function queueGfwReport<T>(task: () => Promise<T>): Promise<T> {
  const run = gfwReportQueue.then(task, task);
  gfwReportQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function readGfwReport(source: Response) {
  if (source.ok) return source.json() as Promise<{ entries?: Array<Record<string, Array<Record<string, unknown>>>> }>;
  if (source.status !== 524) throw new Error(`GFW report failed (${source.status})`);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const recovered = await fetch("https://gateway.api.globalfishingwatch.org/v3/4wings/last-report", {
      headers: { authorization: `Bearer ${gfwApiToken}` },
    });
    if (!recovered.ok) continue;
    const report = await recovered.json() as { status?: string; entries?: Array<Record<string, Array<Record<string, unknown>>>> };
    if (report.status === "running") continue;
    if (report.entries) return report;
    throw new Error("GFW report finished without data");
  }
  throw new Error("GFW report did not finish within its recovery window");
}

function collectGfwPresenceRows(report: { entries?: Array<Record<string, Array<Record<string, unknown>>>> }) {
  const rows: GfwPresenceRow[] = [];
  for (const entry of report.entries ?? []) {
    for (const values of Object.values(entry)) {
      for (const value of values) rows.push(value);
    }
  }
  return rows;
}

function writeJson(response: import("node:http").ServerResponse, status: number, body: unknown, cacheControl = "public, max-age=300") {
  response.writeHead(status, { "content-type": "application/json", "cache-control": cacheControl });
  response.end(JSON.stringify(body));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function fetchSarSnapshot(): Promise<SarSnapshot> {
  if (!gfwApiToken) throw new Error("GFW_API_TOKEN is not configured");
  if (sarCache && sarCache.expiresAt > Date.now()) return sarCache.snapshot;
  return queueGfwReport(async () => {
  if (sarCache && sarCache.expiresAt > Date.now()) return sarCache.snapshot;
  const end = new Date(Date.now() - 5 * 86_400_000);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const dateRange = `${isoDate(start)},${isoDate(end)}`;
  const url = new URL("https://gateway.api.globalfishingwatch.org/v3/4wings/report");
  url.searchParams.set("spatial-resolution", "LOW");
  url.searchParams.set("temporal-resolution", "ENTIRE");
  url.searchParams.set("spatial-aggregation", "false");
  url.searchParams.set("datasets[0]", "public-global-sar-presence:latest");
  url.searchParams.set("filters[0]", "matched='false'");
  url.searchParams.set("date-range", dateRange);
  url.searchParams.set("format", "JSON");
  const source = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${gfwApiToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      geojson: {
        type: "Polygon",
        coordinates: [[[-179.9, -75], [179.9, -75], [179.9, 85], [-179.9, 85], [-179.9, -75]]],
      },
    }),
  });
  const report = await readGfwReport(source);
  const detections = (report.entries ?? [])
    .flatMap((entry) => Object.values(entry).flat())
    .filter((item): item is SarDetection => Number.isFinite(item?.lat) && Number.isFinite(item?.lon) && typeof item?.detections === "number" && item.detections > 0)
    .slice(0, 6000);
  const snapshot: SarSnapshot = {
    observedAt: new Date().toISOString(),
    dateRange,
    source: "Global Fishing Watch · Sentinel-1 SAR",
    filter: "unmatched-with-ais",
    detections,
  };
  sarCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, snapshot };
  return snapshot;
  });
}

async function fetchGfwVoyageProbe(): Promise<GfwVoyageProbe> {
  if (!gfwApiToken) throw new Error("GFW_API_TOKEN is not configured");
  if (gfwVoyageProbeCache && gfwVoyageProbeCache.expiresAt > Date.now()) return gfwVoyageProbeCache.result;
  return queueGfwReport(async () => {
    if (gfwVoyageProbeCache && gfwVoyageProbeCache.expiresAt > Date.now()) return gfwVoyageProbeCache.result;
    const end = new Date(Date.now() - 4 * 86_400_000);
    const windowDays = 4;
    const start = new Date(end.getTime() - windowDays * 86_400_000);
    const dateRange = `${isoDate(start)},${isoDate(end)}`;
    const corridors: GfwVoyageCorridor[] = [];
    const candidates: GfwProbeSummary["candidates"] = [];
    let rows = 0;
    let identifiedVessels = 0;
    let qualifyingVessels = 0;

    for (const corridor of gfwVoyageCorridors) {
      try {
        const url = new URL("https://gateway.api.globalfishingwatch.org/v3/4wings/report");
        url.searchParams.set("spatial-resolution", "LOW");
        url.searchParams.set("temporal-resolution", "DAILY");
        url.searchParams.set("spatial-aggregation", "false");
        url.searchParams.set("group-by", "VESSEL_ID");
        url.searchParams.set("datasets[0]", "public-global-presence:latest");
        url.searchParams.set("filters[0]", 'vessel_type in ("cargo","carrier")');
        url.searchParams.set("date-range", dateRange);
        url.searchParams.set("format", "JSON");
        const source = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${gfwApiToken}`, "content-type": "application/json" },
          body: JSON.stringify({ geojson: { type: "Polygon", coordinates: [corridor.coordinates] } }),
        });
        const report = await readGfwReport(source);
        const corridorRows = collectGfwPresenceRows(report);
        const summary = summarizeGfwVoyageProbe(corridorRows, {
          minimumVessels: 5,
          minimumOrderedPoints: 4,
          minimumDistanceNm: 180,
          maximumSpeedKn: 48,
          limit: 36,
          rankBy: "distance",
        });
        rows += summary.rows;
        identifiedVessels += summary.identifiedVessels;
        qualifyingVessels += summary.qualifyingVessels;
        candidates.push(...summary.candidates.map((candidate) => ({ ...candidate, corridorId: corridor.id, corridorLabel: corridor.label })));
        corridors.push({
          id: corridor.id,
          label: corridor.label,
          focus: corridor.focus,
          rows: summary.rows,
          identifiedVessels: summary.identifiedVessels,
          qualifyingVessels: summary.qualifyingVessels,
          shown: summary.candidates.length,
          status: "live",
        });
      } catch (error) {
        corridors.push({
          id: corridor.id,
          label: corridor.label,
          focus: corridor.focus,
          rows: 0,
          identifiedVessels: 0,
          qualifyingVessels: 0,
          shown: 0,
          status: "error",
          error: error instanceof Error ? error.message : "Corridor report unavailable",
        });
      }
    }

    const rankedCandidates = candidates.sort((a, b) => b.distanceNm - a.distanceNm || b.points.length - a.points.length).slice(0, 180);
    if (rankedCandidates.length === 0) throw new Error("No corridor voyage reports completed successfully");
    const minimumVessels = 20;
    const minimumOrderedPoints = 4;
    const minimumDistanceNm = 180;
    const result: GfwVoyageProbe = {
      observedAt: new Date().toISOString(),
      dateRange,
      region: "Five major shipping corridors",
      source: "Global Fishing Watch · public-global-presence:latest",
      caveat: "Four days of daily gridded AIS presence, not raw AIS. Lines connect observations for the same vessel; gaps between daily cells are not exact sailed tracks.",
      windowDays,
      corridors,
      verdict: rankedCandidates.length >= minimumVessels && corridors.filter((corridor) => corridor.status === "live").length >= 3 ? "pass" : "fail",
      criteria: { minimumVessels, minimumOrderedPoints, minimumDistanceNm },
      rows,
      identifiedVessels,
      qualifyingVessels,
      candidates: rankedCandidates,
    };
    gfwVoyageProbeCache = { expiresAt: Date.now() + 12 * 60 * 60 * 1000, result };
    return result;
  });
}

function worldWakeManifest() {
  const end = new Date(Date.now() - 4 * 86_400_000);
  const start = new Date(end.getTime() - 86_400_000);
  const dateRange = `${isoDate(start)},${isoDate(end)}`;
  return {
    observedAt: new Date().toISOString(),
    dateRange,
    availableThrough: isoDate(end),
    delayDays: 4 as const,
    source: "Global Fishing Watch · AIS vessel presence",
    resolution: "sampled-heatmap" as const,
    filter: "cargo-and-carrier" as const,
    zoom: 2,
    tiles: Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({ x, y, url: `/api/world-wake-tile?x=${x}&y=${y}` }))).flat(),
  };
}

async function fetchWorldWakeTile(x: number, y: number) {
  if (!gfwApiToken) throw new Error("GFW_API_TOKEN is not configured");
  const manifest = worldWakeManifest();
  const key = `${manifest.dateRange}:${x}:${y}`;
  const cached = worldWakeTileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const url = new URL(`https://gateway.api.globalfishingwatch.org/v3/4wings/tile/heatmap/${manifest.zoom}/${x}/${y}`);
  url.searchParams.set("format", "PNG");
  url.searchParams.set("interval", "DAY");
  url.searchParams.set("temporal-aggregation", "true");
  url.searchParams.set("datasets[0]", "public-global-presence:latest");
  url.searchParams.set("filters[0]", 'vessel_type in ("cargo","carrier")');
  url.searchParams.set("date-range", manifest.dateRange);
  url.searchParams.set("style", "eyJjb2xvciI6WzM0LDEzOSwzNF0sInJhbXAiOlswLDc4LDEzNCwyMzQsNDU2LDc4OSwxMTIzLDE1NjcsMjEzNF19");
  const source = await fetch(url, { headers: { authorization: `Bearer ${gfwApiToken}` } });
  if (!source.ok) throw new Error(`GFW world-wake tile failed (${source.status})`);
  const tile = {
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    contentType: source.headers.get("content-type") ?? "image/png",
    data: Buffer.from(await source.arrayBuffer()),
  };
  worldWakeTileCache.set(key, tile);
  return tile;
}

const httpServer = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && (allowedOrigins.size === 0 || allowedOrigins.has(origin))) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" });
    response.end();
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({
      ok: true,
      upstream: !apiKey ? "disabled" : upstreamSubscriptionError
        ? "error"
        : upstream?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
      upstreamError: upstreamSubscriptionError,
      upstreamFrames,
      acceptedVesselFrames,
      lastUpstreamFrameAt,
      lastUpstreamMessageType,
      fintraffic: fintrafficError ? "error" : fintrafficConnected ? "connected" : "reconnecting",
      fintrafficError,
      fintrafficFrames,
      acceptedFintrafficFrames,
      lastFintrafficFrameAt,
      kystverket: !kystverketEnabled ? "disabled" : kystverketError ? "error" : kystverketConnected ? "connected" : "reconnecting",
      kystverketError,
      kystverketFrames,
      acceptedKystverketFrames,
      lastKystverketFrameAt,
      worldWake: !gfwApiToken ? "disabled" : "tile-proxy-ready",
      worldWakeCachedTiles: worldWakeTileCache.size,
      worldWakeAvailableThrough: gfwApiToken ? worldWakeManifest().availableThrough : undefined,
      vessels: vessels.size,
      clients: downstream.clients.size,
      now: new Date().toISOString(),
    }));
    return;
  }
  if (request.url === "/api/sar") {
    if (!gfwApiToken) {
      writeJson(response, 503, { configured: false, message: "Global Fishing Watch token not configured" });
      return;
    }
    try {
      writeJson(response, 200, await fetchSarSnapshot());
    } catch (error) {
      writeJson(response, 502, { configured: true, message: error instanceof Error ? error.message : "SAR source unavailable" });
    }
    return;
  }
  if (request.url === "/api/gfw-voyage-probe") {
    if (!gfwApiToken) {
      writeJson(response, 503, { configured: false, message: "Global Fishing Watch token not configured" }, "no-store");
      return;
    }
    try {
      writeJson(response, 200, await fetchGfwVoyageProbe(), "public, max-age=21600");
    } catch (error) {
      writeJson(response, 502, { configured: true, message: error instanceof Error ? error.message : "GFW voyage probe unavailable" }, "no-store");
    }
    return;
  }
  if (request.url === "/api/world-wake") {
    if (!gfwApiToken) {
      writeJson(response, 503, { configured: false, message: "Global Fishing Watch token not configured" });
      return;
    }
    writeJson(response, 200, worldWakeManifest(), "public, max-age=3600");
    return;
  }
  if (request.url?.startsWith("/api/world-wake-tile")) {
    if (!gfwApiToken) {
      writeJson(response, 503, { configured: false, message: "Global Fishing Watch token not configured" });
      return;
    }
    const tileUrl = new URL(request.url, "http://relay.local");
    const x = Number(tileUrl.searchParams.get("x"));
    const y = Number(tileUrl.searchParams.get("y"));
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 3 || y < 0 || y > 3) {
      writeJson(response, 400, { message: "Invalid world-wake tile" }, "no-store");
      return;
    }
    try {
      const tile = await fetchWorldWakeTile(x, y);
      response.writeHead(200, { "content-type": tile.contentType, "cache-control": "public, max-age=43200" });
      response.end(tile.data);
    } catch (error) {
      writeJson(response, 502, { message: error instanceof Error ? error.message : "World wake tile unavailable" }, "no-store");
    }
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Cargo Constellations AIS relay\n");
});
const downstream = new WebSocketServer({
  server: httpServer,
  verifyClient: ({ origin }: { origin: string }) => allowedOrigins.size === 0 || allowedOrigins.has(origin),
});
let upstream: WebSocket | undefined;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
let upstreamFrames = 0;
let acceptedVesselFrames = 0;
let lastUpstreamFrameAt: string | undefined;
let lastUpstreamMessageType: string | undefined;
let upstreamSubscriptionError: string | undefined;
let fintraffic: MqttClient | undefined;
let fintrafficConnected = false;
let fintrafficFrames = 0;
let acceptedFintrafficFrames = 0;
let lastFintrafficFrameAt: string | undefined;
let fintrafficError: string | undefined;
let kystverket: net.Socket | undefined;
let kystverketReconnectTimer: NodeJS.Timeout | undefined;
let kystverketReconnectAttempt = 0;
let kystverketConnected = false;
let kystverketFrames = 0;
let acceptedKystverketFrames = 0;
let lastKystverketFrameAt: string | undefined;
let kystverketError: string | undefined;
let kystverketBuffer = "";
const kystverketDecoder = new NmeaAisDecoder();

const subscription = {
  APIKey: apiKey,
  BoundingBoxes: fullGlobe
    ? [[[-90, -180], [90, 180]]]
    : [
        [[0.85, 103.35], [1.55, 104.25]],
        [[49.8, -1.8], [52.3, 3.2]],
      ],
};

function publicVessel(vessel: Vessel, includeFullTrail = true): Vessel {
  return {
    ...vessel,
    source: "live",
    trail: includeFullTrail ? vessel.trail : vessel.trail.slice(-2),
    renderedPosition: undefined,
  };
}

type LiveClient = WebSocket & { isAlive?: boolean };

function fintrafficPositionEnvelope(mmsi: string, position: Record<string, unknown>): AisEnvelope {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, Provider: "Fintraffic / digitraffic.fi" },
    Message: { PositionReport: {
      UserID: mmsi,
      Latitude: position.lat,
      Longitude: position.lon,
      Sog: position.sog,
      Cog: position.cog,
      TrueHeading: position.heading,
      NavigationalStatus: position.navStat,
      Timestamp: position.time ?? position.timestampExternal,
    } },
  };
}

function fintrafficMetadataEnvelope(mmsi: string, metadata: Record<string, unknown>): AisEnvelope {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, Provider: "Fintraffic / digitraffic.fi" },
    Message: { ShipStaticData: {
      UserID: mmsi,
      ImoNumber: metadata.imo,
      Name: metadata.name,
      CallSign: metadata.callSign,
      Type: metadata.type ?? metadata.shipType,
      Destination: metadata.destination,
      MaximumStaticDraught: metadata.draught,
      Dimension: {
        A: metadata.refA ?? metadata.referencePointA,
        B: metadata.refB ?? metadata.referencePointB,
        C: metadata.refC ?? metadata.referencePointC,
        D: metadata.refD ?? metadata.referencePointD,
      },
    } },
  };
}

function mergeEnvelope(envelope: AisEnvelope, provider: "aisstream" | "fintraffic" | "kystverket", receivedAt = Date.now()) {
  const payload = envelope.Message?.[envelope.MessageType];
  const mmsi = String(payload?.UserID ?? payload?.MMSI ?? envelope.MetaData?.MMSI ?? "");
  const merged = mergeAisEnvelope(vessels.get(mmsi), envelope, receivedAt, "live");
  if (!merged) return;
  vessels.set(merged.mmsi, merged);
  dirty.add(merged.mmsi);
  if (provider === "aisstream") acceptedVesselFrames += 1;
  if (provider === "fintraffic") acceptedFintrafficFrames += 1;
  if (provider === "kystverket") acceptedKystverketFrames += 1;
}

async function seedFintraffic() {
  const headers = { "Digitraffic-User": fintrafficUserAgent };
  const [positionResponse, metadataResponse] = await Promise.all([
    fetch(fintrafficLocationsUrl, { headers }),
    fetch(fintrafficVesselsUrl, { headers }),
  ]);
  if (!positionResponse.ok || !metadataResponse.ok) {
    throw new Error(`snapshot failed (${positionResponse.status}/${metadataResponse.status})`);
  }
  const positions = await positionResponse.json() as {
    features?: Array<{ mmsi?: number | string; geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
  };
  const metadata = await metadataResponse.json() as Array<Record<string, unknown>>;
  for (const item of metadata) {
    const mmsi = String(item.mmsi ?? "");
    mergeEnvelope(fintrafficMetadataEnvelope(mmsi, item), "fintraffic");
  }
  for (const feature of positions.features ?? []) {
    const mmsi = String(feature.mmsi ?? feature.properties?.mmsi ?? "");
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const receivedAt = Number(feature.properties?.timestampExternal) || Date.now();
    mergeEnvelope(fintrafficPositionEnvelope(mmsi, { ...feature.properties, lat, lon }), "fintraffic", receivedAt);
  }
  lastFintrafficFrameAt = new Date().toISOString();
  console.log(`Fintraffic seeded ${positions.features?.length ?? 0} vessel positions`);
}

function connectFintraffic() {
  fintraffic = mqtt.connect(fintrafficMqttUrl, {
    clientId: `cargo-constellations-${Math.random().toString(16).slice(2)}`,
    reconnectPeriod: 5_000,
    connectTimeout: 15_000,
  });
  fintraffic.on("connect", () => {
    fintrafficConnected = true;
    fintrafficError = undefined;
    fintraffic?.subscribe("vessels-v2/+/+", (error) => {
      if (error) fintrafficError = error.message;
      else console.log("Fintraffic live AIS connected");
    });
  });
  fintraffic.on("message", (topic, raw) => {
    try {
      const [, mmsi, kind] = topic.split("/");
      const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
      fintrafficFrames += 1;
      lastFintrafficFrameAt = new Date().toISOString();
      if (kind === "location") {
        const receivedAt = Number(payload.time) * 1000 || Date.now();
        mergeEnvelope(fintrafficPositionEnvelope(mmsi, payload), "fintraffic", receivedAt);
      }
      if (kind === "metadata") mergeEnvelope(fintrafficMetadataEnvelope(mmsi, payload), "fintraffic");
    } catch (error) {
      console.warn("Dropped malformed Fintraffic frame", error instanceof Error ? error.message : error);
    }
  });
  fintraffic.on("reconnect", () => { fintrafficConnected = false; });
  fintraffic.on("close", () => { fintrafficConnected = false; });
  fintraffic.on("error", (error) => {
    fintrafficConnected = false;
    fintrafficError = error.message;
    console.warn("Fintraffic AIS error", error.message);
  });
}

function connectKystverket() {
  if (!kystverketEnabled || shuttingDown) return;
  kystverket = net.createConnection({ host: kystverketHost, port: kystverketPort });
  kystverket.setKeepAlive(true, 30_000);
  kystverket.setTimeout(45_000);
  kystverket.on("connect", () => {
    kystverketConnected = true;
    kystverketError = undefined;
    kystverketReconnectAttempt = 0;
    console.log("Kystverket open AIS connected · Norwegian waters");
  });
  kystverket.on("data", (chunk) => {
    kystverketBuffer += chunk.toString("ascii");
    const lines = kystverketBuffer.split(/\r?\n/);
    kystverketBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      kystverketFrames += 1;
      lastKystverketFrameAt = new Date().toISOString();
      try {
        for (const envelope of kystverketDecoder.decode(line)) mergeEnvelope(envelope, "kystverket");
      } catch (error) {
        console.warn("Dropped malformed Kystverket frame", error instanceof Error ? error.message : error);
      }
    }
  });
  kystverket.on("timeout", () => {
    kystverketError = "stream timed out";
    kystverket?.destroy();
  });
  kystverket.on("error", (error) => {
    kystverketConnected = false;
    kystverketError = error.message;
  });
  kystverket.on("close", () => {
    kystverketConnected = false;
    if (shuttingDown) return;
    const base = Math.min(60_000, 1_000 * 2 ** kystverketReconnectAttempt);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    kystverketReconnectAttempt += 1;
    kystverketReconnectTimer = setTimeout(connectKystverket, delay);
  });
}

downstream.on("connection", (client: LiveClient) => {
  client.isAlive = true;
  client.on("pong", () => { client.isAlive = true; });
  const snapshot = [...vessels.values()].filter((vessel) => vessel.lastFix).map((vessel) => publicVessel(vessel));
  client.send(JSON.stringify({ type: "snapshot", sentAt: Date.now(), vessels: snapshot }));
});

const heartbeatTimer = setInterval(() => {
  for (const client of downstream.clients as Set<LiveClient>) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30_000);

const flushTimer = setInterval(() => {
  if (!dirty.size) return;
  const deltas = [...dirty]
    .map((mmsi) => vessels.get(mmsi))
    .filter((vessel): vessel is Vessel => Boolean(vessel))
    .map((vessel) => publicVessel(vessel, false));
  dirty.clear();
  const frame = JSON.stringify({ type: "deltas", sentAt: Date.now(), vessels: deltas });
  for (const client of downstream.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(frame);
  }
}, 1000);

const pruneTimer = setInterval(() => {
  const cutoff = Date.now() - vesselTtlMs;
  for (const [mmsi, vessel] of vessels) {
    if (!vessel.lastFix || vessel.lastFix.receivedAt < cutoff) vessels.delete(mmsi);
  }
}, 60_000);

function connectUpstream() {
  if (shuttingDown) return;
  upstream = new WebSocket(upstreamUrl);

  upstream.on("open", () => {
    reconnectAttempt = 0;
    upstreamSubscriptionError = undefined;
    upstream?.send(JSON.stringify(subscription));
    console.log(`AIS upstream connected · relay listening on ws://localhost:${downstreamPort}`);
  });

  upstream.on("message", (raw) => {
    try {
      const decoded = JSON.parse(raw.toString()) as AisEnvelope | { error?: unknown };
      upstreamFrames += 1;
      lastUpstreamFrameAt = new Date().toISOString();
      if ("error" in decoded && typeof decoded.error === "string") {
        upstreamSubscriptionError = decoded.error;
        console.error(`AIS subscription rejected: ${decoded.error}`);
        return;
      }
      const envelope = decoded as AisEnvelope;
      lastUpstreamMessageType = envelope.MessageType;
      mergeEnvelope(envelope, "aisstream");
    } catch (error) {
      console.warn("Dropped malformed AIS frame", error instanceof Error ? error.message : error);
    }
  });

  upstream.on("close", (code) => {
    if (shuttingDown) return;
    const base = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    reconnectAttempt += 1;
    console.warn(`AIS upstream closed (${code}); reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(connectUpstream, delay);
  });

  upstream.on("error", (error) => {
    console.warn("AIS upstream error", error.message);
    upstream?.close();
  });
}

function shutdown() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (kystverketReconnectTimer) clearTimeout(kystverketReconnectTimer);
  clearInterval(flushTimer);
  clearInterval(pruneTimer);
  clearInterval(heartbeatTimer);
  upstream?.close();
  fintraffic?.end(true);
  kystverket?.destroy();
  downstream.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
httpServer.listen(downstreamPort, "0.0.0.0", () => {
  console.log(`AIS relay listening on http://0.0.0.0:${downstreamPort}`);
});
if (apiKey) connectUpstream();
else console.log("AISstream disabled · no API key configured");
seedFintraffic().catch((error) => {
  fintrafficError = error instanceof Error ? error.message : "snapshot unavailable";
  console.warn("Fintraffic seed error", fintrafficError);
});
connectFintraffic();
connectKystverket();
