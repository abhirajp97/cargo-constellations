import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { mergeAisEnvelope, type AisEnvelope, type Vessel } from "../lib/ais.js";

const upstreamUrl = "wss://stream.aisstream.io/v0/stream";
const apiKey = process.env.AISSTREAM_API_KEY;
const downstreamPort = Number(process.env.PORT ?? process.env.AIS_RELAY_PORT ?? 8787);
const fullGlobe = process.env.AIS_FULL_GLOBE === "true";
const vesselTtlMs = 60 * 60 * 1000;
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));

if (!apiKey) {
  console.error("AISSTREAM_API_KEY is required. Copy .env.example to .env and add your aisstream.io key.");
  process.exit(1);
}

const vessels = new Map<string, Vessel>();
const dirty = new Set<string>();
const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({
      ok: true,
      upstream: upstream?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
      vessels: vessels.size,
      clients: downstream.clients.size,
      now: new Date().toISOString(),
    }));
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Cargo Constellations AIS relay\n");
});
const downstream = new WebSocketServer({
  server: httpServer,
  verifyClient: ({ origin }) => allowedOrigins.size === 0 || allowedOrigins.has(origin),
});
let upstream: WebSocket | undefined;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;

const subscription = {
  APIKey: apiKey,
  BoundingBoxes: fullGlobe
    ? [[[-90, -180], [90, 180]]]
    : [
        [[0.85, 103.35], [1.55, 104.25]],
        [[49.8, -1.8], [52.3, 3.2]],
      ],
  FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"],
};

function publicVessel(vessel: Vessel): Vessel {
  return { ...vessel, source: "live", renderedPosition: undefined };
}

type LiveClient = WebSocket & { isAlive?: boolean };

downstream.on("connection", (client: LiveClient) => {
  client.isAlive = true;
  client.on("pong", () => { client.isAlive = true; });
  const snapshot = [...vessels.values()].filter((vessel) => vessel.lastFix).map(publicVessel);
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
    .map(publicVessel);
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
    upstream?.send(JSON.stringify(subscription));
    console.log(`AIS upstream connected · relay listening on ws://localhost:${downstreamPort}`);
  });

  upstream.on("message", (raw) => {
    try {
      const envelope = JSON.parse(raw.toString()) as AisEnvelope;
      const payload = envelope.Message?.[envelope.MessageType];
      const mmsi = String(payload?.UserID ?? payload?.MMSI ?? envelope.MetaData?.MMSI ?? "");
      const merged = mergeAisEnvelope(vessels.get(mmsi), envelope, Date.now(), "live");
      if (!merged) return;
      vessels.set(merged.mmsi, merged);
      dirty.add(merged.mmsi);
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
  clearInterval(flushTimer);
  clearInterval(pruneTimer);
  clearInterval(heartbeatTimer);
  upstream?.close();
  downstream.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
httpServer.listen(downstreamPort, "0.0.0.0", () => {
  console.log(`AIS relay listening on http://0.0.0.0:${downstreamPort}`);
});
connectUpstream();
