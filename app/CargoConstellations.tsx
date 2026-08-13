"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import {
  deadReckonedPosition,
  mergeAisEnvelope,
  navStatusLabel,
  type AisEnvelope,
  type Commodity,
  type Vessel,
} from "../lib/ais";
import { CHOKEPOINTS, createMockAisSource } from "../lib/mock-ais";
import { ENVIRONMENT_SAMPLES, fetchEnvironment, type EnvironmentPoint } from "../lib/environment";
import { DATA_LAYERS, defaultLayerSet, type LayerId } from "../lib/layers";
import { PORT_SANCTUARIES, resolveDestination, type PortSanctuary } from "../lib/ports";
import {
  fetchDelayedVoyagePilot,
  fetchSarDetections,
  fetchStaticIntelligence,
  fetchWorldWake,
  type DelayedVoyagePilot,
  type SarSnapshot,
  type StaticIntelligence,
  type WorldWakeSnapshot,
} from "../lib/intelligence";

const COLORS: Record<Commodity, string> = {
  container: "#F3D28A",
  "dry-bulk": "#EF9A6D",
  tanker: "#D9797F",
  general: "#8FC7AE",
  unknown: "#C9BFA9",
};

const LABELS: Record<Commodity, string> = {
  container: "Cargo / container",
  "dry-bulk": "Likely dry bulk",
  tanker: "Tanker",
  general: "General cargo",
  unknown: "Unclassified",
};

const FILTERS: Commodity[] = ["container", "dry-bulk", "tanker", "general"];
const EMPTY_COUNTS: Record<Commodity, number> = { container: 0, "dry-bulk": 0, tanker: 0, general: 0, unknown: 0 };
const DEFAULT_AIS_WEBSOCKET_URL = "wss://cargo-constellations-ais-relay.onrender.com";
const AIS_WEBSOCKET_URL = process.env.NEXT_PUBLIC_AIS_WEBSOCKET_URL || DEFAULT_AIS_WEBSOCKET_URL;

const LAYER_GUIDE: Partial<Record<LayerId, { color: string; cue: string; focus?: [number, number] }>> = {
  "delayed-voyages": { color: "#F3D28A", cue: "Gold constellations join ordered hourly cargo-vessel observations from four days ago.", focus: [-103, -2] },
  "live-vessels": { color: "#E6B86C", cue: "Crisp lanterns and solid trails are successive AIS fixes heard in Finland and Norway.", focus: [-15, -57] },
  coverage: { color: "#9FCDB9", cue: "Soft washes reveal where the current public receiver networks can hear ships.", focus: [-15, -57] },
  bathymetry: { color: "#4B8F9D", cue: "Nested blue contours show depth bands beneath the ocean." },
  routes: { color: "#E9C46A", cue: "Gold dotted paths are computed sea routes, not live vessel tracks." },
  "day-night": { color: "#8CB8E8", cue: "The shaded hemisphere is night; its edge follows the real UTC sun." },
  chokepoints: { color: "#F1D08A", cue: "Gold breathing rings mark the narrow passages trade funnels through." },
  winds: { color: "#C7E4DE", cue: "Pale moving strokes show modeled surface-wind direction and speed." },
  waves: { color: "#78AEE8", cue: "Blue rings grow with modeled significant wave height." },
  currents: { color: "#5DD9CF", cue: "Teal strokes trace modeled surface-current direction and speed." },
  "load-state": { color: "#E9C46A", cue: "Likely laden ships stay bright; likely ballast ships become quieter." },
  "port-congestion": { color: "#F08D68", cue: "Warm rings gather around ports with anchored or moored vessels." },
  "ais-gaps": { color: "#F08D68", cue: "Dotted rings mark vessels silent for more than ten minutes." },
  "sea-ice": { color: "#D9F2F4", cue: "Pale polar cells show daily sea-ice concentration above 15%.", focus: [0, -62] },
  "world-wake": { color: "#74DCC7", cue: "Teal marks are optional aggregate cargo-presence cells—not ships, identities, or routes." },
  "dark-vessels": { color: "#F4A868", cue: "Crosses are radar vessel detections not matched to AIS—not proof of intent." },
  "canal-restrictions": { color: "#F08D68", cue: "A warm dashed pulse marks current Panama Canal advisories.", focus: [79.68, -9.08] },
  piracy: { color: "#FF765F", cue: "Warm diamonds are incidents reported to the IMB Piracy Reporting Centre.", focus: [-100, -8] },
  "commodity-prices": { color: "#E9C46A", cue: "Monthly public benchmarks appear in the adjacent reading panel." },
};

type LandGeometry = ReturnType<typeof feature> | null;
type BathymetryGeometry = { depth: number; geometry: LandGeometry };

const COVERAGE_FIELDS = [
  { type: "Feature", properties: { provider: "Fintraffic" }, geometry: { type: "Polygon", coordinates: [[[15.2, 55.1], [31.2, 55.1], [31.2, 66.4], [15.2, 66.4], [15.2, 55.1]]] } },
  { type: "Feature", properties: { provider: "Kystverket" }, geometry: { type: "Polygon", coordinates: [[[-6, 56], [5, 54.5], [14, 57], [31, 67], [33, 72], [17, 73], [3, 68], [-6, 62], [-6, 56]]] } },
  { type: "Feature", properties: { provider: "Kystverket" }, geometry: { type: "Polygon", coordinates: [[[-12, 72], [38, 72], [38, 82], [-12, 82], [-12, 72]]] } },
] as const;

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}°${value >= 0 ? positive : negative}`;
}

function formatPrice(value: number) {
  return value >= 100 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : value.toFixed(2);
}

function trailDistanceNm(trail: Vessel["trail"]) {
  let total = 0;
  for (let index = 1; index < trail.length; index += 1) {
    total += d3.geoDistance([trail[index - 1][0], trail[index - 1][1]], [trail[index][0], trail[index][1]]) * 3440.065;
  }
  return total;
}

function formatTrailDuration(trail: Vessel["trail"]) {
  if (trail.length < 2) return "gathering fixes";
  const minutes = Math.max(1, Math.round((trail.at(-1)![2] - trail[0][2]) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} hr` : `${Math.round(hours)} hr`;
}

function voyageWeather(vessel: Vessel | undefined, destination: PortSanctuary | undefined, samples: EnvironmentPoint[]) {
  if (!vessel?.lastFix || !samples.length) return undefined;
  const origin: [number, number] = [vessel.lastFix.lon, vessel.lastFix.lat];
  const target = destination?.coords ?? origin;
  const midpoint = d3.geoInterpolate(origin, target)(0.5) as [number, number];
  return samples.reduce((nearest, sample) =>
    d3.geoDistance(midpoint, sample.coords) < d3.geoDistance(midpoint, nearest.coords) ? sample : nearest,
  );
}

function sunPosition(date: Date): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86_400_000;
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return [(12 - utcHours) * 15, declination];
}

function makeGlowSprite(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 56;
  canvas.height = 56;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const gradient = context.createRadialGradient(28, 28, 0, 28, 28, 27);
  gradient.addColorStop(0, "rgba(255,248,218,1)");
  gradient.addColorStop(0.1, rgba(color, 0.95));
  gradient.addColorStop(0.42, rgba(color, 0.28));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 56, 56);
  context.save();
  context.translate(28, 28);
  context.fillStyle = "rgba(255,248,218,.96)";
  context.beginPath();
  context.moveTo(0, -5);
  context.quadraticCurveTo(2.6, -1.8, 5, 0);
  context.quadraticCurveTo(2.6, 1.8, 0, 5);
  context.quadraticCurveTo(-2.6, 1.8, -5, 0);
  context.quadraticCurveTo(-2.6, -1.8, 0, -5);
  context.fill();
  context.restore();
  return canvas;
}

function makeWakeSprite(warm = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.save();
  context.translate(40, 24);
  context.scale(1.7, 0.72);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 22);
  gradient.addColorStop(0, warm ? "rgba(255, 225, 157, .95)" : "rgba(196, 255, 235, .88)");
  gradient.addColorStop(0.12, warm ? "rgba(238, 177, 91, .62)" : "rgba(91, 229, 207, .58)");
  gradient.addColorStop(0.46, warm ? "rgba(202, 121, 67, .18)" : "rgba(45, 169, 177, .2)");
  gradient.addColorStop(1, "rgba(17, 86, 116, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 22, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.strokeStyle = warm ? "rgba(255, 226, 166, .72)" : "rgba(150, 247, 225, .52)";
  context.lineWidth = warm ? 1 : 0.7;
  context.beginPath();
  context.moveTo(31, 24);
  context.quadraticCurveTo(40, 19, 49, 24);
  context.quadraticCurveTo(40, 29, 31, 24);
  context.stroke();
  return canvas;
}

export default function CargoConstellations() {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storeRef = useRef(new Map<string, Vessel>());
  const rotationRef = useRef<[number, number]>([-103, -2]);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pointerRef = useRef<[number, number]>([0, 0]);
  const autoRotateRef = useRef(false);
  const zoomRef = useRef(1.45);
  const hitRef = useRef<Array<{ mmsi: string; x: number; y: number }>>([]);
  const filterRef = useRef(new Set<Commodity>(FILTERS));
  const layerRef = useRef(defaultLayerSet());
  const landRef = useRef<LandGeometry>(null);
  const bathymetryRef = useRef<BathymetryGeometry[]>([]);
  const routesRef = useRef<unknown>(null);
  const environmentRef = useRef<EnvironmentPoint[]>(ENVIRONMENT_SAMPLES);
  const intelligenceRef = useRef<StaticIntelligence | null>(null);
  const sarRef = useRef<SarSnapshot | null>(null);
  const worldWakeRef = useRef<WorldWakeSnapshot | null>(null);
  const delayedVoyagePilotRef = useRef<DelayedVoyagePilot | null>(null);
  const portCongestionRef = useRef(new Map<string, number>());
  const audioRef = useRef<{ context: AudioContext; sources: AudioScheduledSourceNode[] } | null>(null);
  const lastDrawRef = useRef(0);

  const [dimensions, setDimensions] = useState({ width: 1200, height: 760 });
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selected, setSelected] = useState<Vessel | undefined>();
  const [autoRotate, setAutoRotate] = useState(false);
  const [filters, setFilters] = useState(new Set<Commodity>(FILTERS));
  const [layers, setLayers] = useState(defaultLayerSet);
  const [clock, setClock] = useState(new Date(0));
  const wsUrl = AIS_WEBSOCKET_URL;
  const [connection, setConnection] = useState<"demo" | "connecting" | "live" | "offline">(wsUrl ? "connecting" : "demo");
  const [environmentStatus, setEnvironmentStatus] = useState<"loading" | "live" | "offline">("loading");
  const [environment, setEnvironment] = useState<EnvironmentPoint[]>(ENVIRONMENT_SAMPLES);
  const [intelligenceStatus, setIntelligenceStatus] = useState<"loading" | "live" | "offline">("loading");
  const [sarStatus, setSarStatus] = useState<"key" | "loading" | "live" | "offline">(wsUrl ? "loading" : "key");
  const [worldWakeStatus, setWorldWakeStatus] = useState<"key" | "loading" | "live" | "offline">(wsUrl ? "loading" : "key");
  const [intelligence, setIntelligence] = useState<StaticIntelligence | null>(null);
  const [sar, setSar] = useState<SarSnapshot | null>(null);
  const [worldWake, setWorldWake] = useState<WorldWakeSnapshot | null>(null);
  const [delayedVoyageStatus, setDelayedVoyageStatus] = useState<"key" | "loading" | "live" | "offline">(wsUrl ? "loading" : "key");
  const [delayedVoyagePilot, setDelayedVoyagePilot] = useState<DelayedVoyagePilot | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [layerMoment, setLayerMoment] = useState<{ id: LayerId; enabled: boolean } | null>(null);
  const [stats, setStats] = useState({ vessels: 0, moving: 0, laden: 0, anchors: 0, gaps: 0, fintraffic: 0, kystverket: 0, counts: EMPTY_COUNTS });
  const sarRequested = layers.has("dark-vessels");
  const worldWakeRequested = layers.has("world-wake");
  const delayedVoyagesRequested = layers.has("delayed-voyages");
  const liveVesselsRequested = layers.has("live-vessels");

  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { filterRef.current = filters; }, [filters]);
  useEffect(() => { layerRef.current = layers; }, [layers]);

  useEffect(() => {
    if (!soundOn) {
      audioRef.current?.sources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      audioRef.current?.context.close().catch(() => undefined);
      audioRef.current = null;
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 2.5);
    master.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    filter.connect(master);

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    let drift = 0;
    for (let index = 0; index < noise.length; index += 1) {
      drift = (drift + (Math.random() * 2 - 1) * 0.018) * 0.997;
      noise[index] = drift;
    }
    const sea = context.createBufferSource();
    sea.buffer = noiseBuffer;
    sea.loop = true;
    sea.connect(filter);

    const tone = context.createOscillator();
    const toneGain = context.createGain();
    tone.type = "sine";
    tone.frequency.value = 54;
    toneGain.gain.value = 0.028;
    tone.connect(toneGain).connect(master);

    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = 0.075;
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(toneGain.gain);
    [sea, tone, lfo].forEach((source) => source.start());
    audioRef.current = { context, sources: [sea, tone, lfo] };

    return () => {
      [sea, tone, lfo].forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      context.close().catch(() => undefined);
      audioRef.current = null;
    };
  }, [soundOn]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stopped = false;
    fetchStaticIntelligence()
      .then((data) => {
        if (stopped) return;
        intelligenceRef.current = data;
        setIntelligence(data);
        setIntelligenceStatus("live");
      })
      .catch(() => { if (!stopped) setIntelligenceStatus("offline"); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (!wsUrl || !sarRequested) return;
    let stopped = false;
    const update = () => {
      setSarStatus((current) => current === "live" ? current : "loading");
      fetchSarDetections(wsUrl)
        .then((snapshot) => {
          if (stopped) return;
          sarRef.current = snapshot;
          setSar(snapshot);
          setSarStatus("live");
        })
        .catch((error) => {
          if (stopped) return;
          setSarStatus(error instanceof Error && error.message.includes("token") ? "key" : "offline");
        });
    };
    update();
    const timer = window.setInterval(update, 6 * 60 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [wsUrl, sarRequested]);

  useEffect(() => {
    if (!wsUrl || !worldWakeRequested) return;
    let stopped = false;
    const update = () => {
      setWorldWakeStatus((current) => current === "live" ? current : "loading");
      fetchWorldWake(wsUrl)
        .then((snapshot) => {
          if (stopped) return;
          worldWakeRef.current = snapshot;
          setWorldWake(snapshot);
          setWorldWakeStatus("live");
        })
        .catch((error) => {
          if (stopped) return;
          setWorldWakeStatus(error instanceof Error && error.message.includes("token") ? "key" : "offline");
        });
    };
    update();
    const timer = window.setInterval(update, 12 * 60 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [wsUrl, worldWakeRequested]);

  useEffect(() => {
    if (!wsUrl || !delayedVoyagesRequested) return;
    let stopped = false;
    const update = () => {
      setDelayedVoyageStatus((current) => current === "live" ? current : "loading");
      fetchDelayedVoyagePilot(wsUrl)
        .then((pilot) => {
          if (stopped) return;
          delayedVoyagePilotRef.current = pilot;
          setDelayedVoyagePilot(pilot);
          setDelayedVoyageStatus(pilot.verdict === "pass" ? "live" : "offline");
        })
        .catch((error) => {
          if (stopped) return;
          setDelayedVoyageStatus(error instanceof Error && error.message.includes("token") ? "key" : "offline");
        });
    };
    update();
    const timer = window.setInterval(update, 12 * 60 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [wsUrl, delayedVoyagesRequested]);

  useEffect(() => {
    Promise.all([
      fetch("/land-110m.json").then(async (response) => await response.json() as Topology<{ land: GeometryCollection }>),
      fetch("/bathymetry.json").then(async (response) => await response.json() as Topology<Record<string, GeometryCollection>>),
      fetch("/maritime-lanes.json").then((response) => response.json()),
    ]).then(([world, bathymetry, routes]) => {
      landRef.current = feature(world, world.objects.land);
      bathymetryRef.current = [
        { depth: 200, geometry: feature(bathymetry, bathymetry.objects.bathy_200) },
        { depth: 1000, geometry: feature(bathymetry, bathymetry.objects.bathy_1000) },
        { depth: 3000, geometry: feature(bathymetry, bathymetry.objects.bathy_3000) },
        { depth: 5000, geometry: feature(bathymetry, bathymetry.objects.bathy_5000) },
      ];
      routesRef.current = routes;
    }).catch(() => {
      landRef.current = null;
      bathymetryRef.current = [];
      routesRef.current = null;
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    const update = () => {
      fetchEnvironment()
        .then((points) => {
          if (stopped) return;
          environmentRef.current = points;
          setEnvironment(points);
          setEnvironmentStatus("live");
        })
        .catch(() => { if (!stopped) setEnvironmentStatus("offline"); });
    };
    update();
    const timer = window.setInterval(update, 15 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!liveVesselsRequested) {
      storeRef.current.clear();
      return;
    }
    const update = (envelope: AisEnvelope, source: Vessel["source"]) => {
      const payload = envelope.Message?.[envelope.MessageType];
      const mmsi = String(payload?.UserID ?? payload?.MMSI ?? envelope.MetaData?.MMSI ?? "");
      const merged = mergeAisEnvelope(storeRef.current.get(mmsi), envelope, Date.now(), source);
      if (merged) storeRef.current.set(merged.mmsi, merged);
    };

    if (!wsUrl) {
      const mock = createMockAisSource((message) => update(message, "mock"));
      return () => mock.stop();
    }

    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnection("connecting");
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          const deltas = frame.type === "snapshot" || frame.type === "deltas" ? frame.vessels : [frame];
          let receivedPosition = false;
          for (const vessel of deltas as Vessel[]) {
            if (vessel.lastFix) receivedPosition = true;
            const existing = storeRef.current.get(vessel.mmsi);
            const nextTrail = [...(existing?.trail ?? [])];
            for (const point of vessel.trail ?? []) {
              const last = nextTrail.at(-1);
              if (last?.[2] === point[2]) nextTrail[nextTrail.length - 1] = point;
              else if (!last || point[2] > last[2]) nextTrail.push(point);
            }
            const trailCutoff = Date.now() - 24 * 60 * 60 * 1000;
            const recentTrail = nextTrail.filter((point) => point[2] >= trailCutoff).slice(-1440);
            storeRef.current.set(vessel.mmsi, {
              ...existing,
              ...vessel,
              source: "live",
              trail: recentTrail,
              renderedPosition: existing?.renderedPosition,
            });
          }
          if (receivedPosition) {
            setConnection("live");
          }
        } catch { /* ignore malformed downstream frames */ }
      };
      socket.onclose = () => {
        setConnection("offline");
        retry = window.setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [wsUrl, liveVesselsRequested]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!layerRef.current.has("live-vessels")) return;
      setClock(new Date(now));
      const vessels = [...storeRef.current.values()].filter((vessel) => vessel.lastFix && now - vessel.lastFix.receivedAt < 3_600_000);
      const counts = { ...EMPTY_COUNTS };
      for (const vessel of vessels) counts[vessel.commodity ?? "unknown"] += 1;
      if (layerRef.current.has("port-congestion")) {
        const anchored = vessels.filter((vessel) => [1, 5].includes(vessel.lastFix?.navStatus ?? -1));
        const congestion = new Map<string, number>();
        for (const port of PORT_SANCTUARIES) {
          let nearby = 0;
          for (const vessel of anchored) {
            if (vessel.lastFix && d3.geoDistance(port.coords, [vessel.lastFix.lon, vessel.lastFix.lat]) * 3440.065 < 35) nearby += 1;
          }
          if (nearby) congestion.set(port.locode, nearby);
        }
        portCongestionRef.current = congestion;
      }
      setStats({
        vessels: vessels.length,
        moving: vessels.filter((vessel) => (vessel.lastFix?.sog ?? 0) > 1).length,
        laden: vessels.filter((vessel) => vessel.loadState === "laden").length,
        anchors: vessels.filter((vessel) => [1, 5].includes(vessel.lastFix?.navStatus ?? -1)).length,
        gaps: vessels.filter((vessel) => vessel.lastFix && now - vessel.lastFix.receivedAt >= 600_000).length,
        fintraffic: vessels.filter((vessel) => vessel.provider?.includes("Fintraffic")).length,
        kystverket: vessels.filter((vessel) => vessel.provider?.includes("Kystverket")).length,
        counts,
      });
      setSelected(selectedMmsi ? storeRef.current.get(selectedMmsi) : undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [selectedMmsi]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.2);
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sprites = Object.fromEntries(
      Object.entries(COLORS).map(([key, color]) => [key, makeGlowSprite(color)]),
    ) as Record<Commodity, HTMLCanvasElement>;
    const wakeSprite = makeWakeSprite();
    const wakeStarSprite = makeWakeSprite(true);
    const graticule = d3.geoGraticule10();
    let animation = 0;
    let previousFrame = 0;

    const frame = (now: number) => {
      animation = window.requestAnimationFrame(frame);
      if (document.hidden || now - previousFrame < 40) return;
      previousFrame = now;
      const wallNow = Date.now();
      const elapsed = Math.min((now - lastDrawRef.current) / 1000, 0.1);
      lastDrawRef.current = now;
      if (!draggingRef.current && autoRotateRef.current) rotationRef.current[0] += elapsed * 1.15;

      const globeSpace = dimensions.width >= 900 ? dimensions.width - 330 : dimensions.width;
      const radius = Math.max(130, Math.min(globeSpace * 0.44, dimensions.height * 0.44) * zoomRef.current);
      const centerX = dimensions.width >= 900 ? globeSpace * 0.52 : dimensions.width * 0.5;
      const centerY = dimensions.height * 0.52;
      const projection = d3.geoOrthographic()
        .translate([centerX, centerY])
        .scale(radius)
        .rotate(rotationRef.current)
        .clipAngle(90);
      const path = d3.geoPath(projection, context);
      const centerLon = -rotationRef.current[0] * Math.PI / 180;
      const centerLat = -rotationRef.current[1] * Math.PI / 180;
      const centerCos = Math.cos(centerLat);
      const centerSin = Math.sin(centerLat);
      const visible = (coordinate: [number, number]) => {
        const lon = coordinate[0] * Math.PI / 180;
        const lat = coordinate[1] * Math.PI / 180;
        return Math.cos(lat) * centerCos * Math.cos(lon - centerLon) + Math.sin(lat) * centerSin > 0;
      };

      context.clearRect(0, 0, dimensions.width, dimensions.height);

      context.save();
      context.beginPath();
      path({ type: "Sphere" });
      const ocean = context.createRadialGradient(centerX - radius * 0.34, centerY - radius * 0.38, radius * 0.03, centerX, centerY, radius * 1.08);
      ocean.addColorStop(0, "#517E98");
      ocean.addColorStop(0.26, "#285B78");
      ocean.addColorStop(0.66, "#113D5A");
      ocean.addColorStop(1, "#071D37");
      context.fillStyle = ocean;
      context.fill();
      context.clip();

      context.save();
      context.lineCap = "round";
      context.globalCompositeOperation = "screen";
      for (let ribbon = 0; ribbon < 13; ribbon += 1) {
        const y = centerY - radius * 0.82 + ribbon * radius * 0.135;
        const sway = Math.sin(now / 6800 + ribbon * 1.41) * radius * 0.045;
        context.beginPath();
        context.moveTo(centerX - radius * 1.03, y + sway);
        context.bezierCurveTo(
          centerX - radius * (0.5 - (ribbon % 3) * 0.07),
          y - radius * (0.07 + (ribbon % 4) * 0.014),
          centerX + radius * (0.28 + (ribbon % 2) * 0.08),
          y + radius * (0.08 + (ribbon % 3) * 0.018),
          centerX + radius * 1.05,
          y - sway * 0.5,
        );
        context.strokeStyle = ribbon % 4 === 0 ? "rgba(224, 166, 92, 0.09)" : "rgba(181, 211, 196, 0.052)";
        context.lineWidth = 1.1 + (ribbon % 4) * 1.35;
        context.stroke();
      }
      context.globalCompositeOperation = "source-over";
      context.restore();

      if (layerRef.current.has("coverage")) {
        for (const field of COVERAGE_FIELDS) {
          context.beginPath();
          path(field as never);
          const norwegian = field.properties.provider === "Kystverket";
          context.fillStyle = norwegian ? "rgba(116, 178, 168, 0.075)" : "rgba(224, 182, 104, 0.07)";
          context.fill();
          context.setLineDash([2, 8]);
          context.lineCap = "round";
          context.strokeStyle = norwegian ? "rgba(157, 211, 191, 0.24)" : "rgba(233, 191, 112, 0.24)";
          context.lineWidth = 0.85;
          context.stroke();
          context.setLineDash([]);
        }
      }

      if (layerRef.current.has("bathymetry")) {
        const depthColors: Record<number, string> = {
          200: "rgba(131, 167, 157, 0.18)",
          1000: "rgba(56, 93, 119, 0.2)",
          3000: "rgba(24, 56, 91, 0.24)",
          5000: "rgba(8, 28, 57, 0.3)",
        };
        for (const contour of bathymetryRef.current) {
          if (!contour.geometry) continue;
          context.beginPath();
          path(contour.geometry as never);
          context.fillStyle = depthColors[contour.depth];
          context.fill();
          context.strokeStyle = "rgba(229, 213, 169, 0.1)";
          context.lineWidth = 0.6;
          context.stroke();
        }
      }

      if (landRef.current) {
        context.beginPath();
        path(landRef.current as never);
        const landWash = context.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
        landWash.addColorStop(0, "rgba(41, 58, 62, .5)");
        landWash.addColorStop(0.42, "rgba(27, 45, 51, .56)");
        landWash.addColorStop(1, "rgba(14, 31, 42, .64)");
        context.fillStyle = landWash;
        context.fill();
        context.strokeStyle = "rgba(145, 185, 181, 0.18)";
        context.lineWidth = 0.65;
        context.stroke();
      }

      context.beginPath();
      path(graticule);
      context.setLineDash([0.8, 10]);
      context.lineCap = "round";
      context.strokeStyle = "rgba(238, 214, 160, 0.115)";
      context.lineWidth = 0.8;
      context.stroke();
      context.setLineDash([]);

      if (layerRef.current.has("routes") && routesRef.current) {
        context.beginPath();
        path(routesRef.current as never);
        context.setLineDash([]);
        context.strokeStyle = "rgba(238, 183, 86, 0.12)";
        context.lineWidth = 4.5;
        context.stroke();
        context.beginPath();
        path(routesRef.current as never);
        context.setLineDash([1, 7]);
        context.lineCap = "round";
        context.strokeStyle = "rgba(250, 210, 125, 0.68)";
        context.lineWidth = 1.5;
        context.stroke();
        context.setLineDash([]);
      }

      const focusedVessel = layerRef.current.has("live-vessels") && selectedMmsi ? storeRef.current.get(selectedMmsi) : undefined;
      const inferredDestination = resolveDestination(focusedVessel?.destination);
      if (focusedVessel?.lastFix && inferredDestination) {
        const origin: [number, number] = [focusedVessel.lastFix.lon, focusedVessel.lastFix.lat];
        const interpolate = d3.geoInterpolate(origin, inferredDestination.coords);
        const inferredRoute = {
          type: "LineString",
          coordinates: Array.from({ length: 49 }, (_, index) => interpolate(index / 48)),
        };
        context.save();
        context.beginPath();
        path(inferredRoute as never);
        context.strokeStyle = "rgba(236, 207, 148, 0.12)";
        context.lineWidth = 8;
        context.lineCap = "round";
        context.stroke();
        context.beginPath();
        path(inferredRoute as never);
        context.setLineDash([10, 5, 2, 5]);
        context.lineDashOffset = -(now / 180) % 22;
        context.strokeStyle = "rgba(242, 215, 162, 0.72)";
        context.lineWidth = 1.5;
        context.stroke();
        context.restore();
      }

      if (layerRef.current.has("day-night")) {
        const sun = sunPosition(new Date());
        const nightCenter: [number, number] = [((sun[0] + 180 + 540) % 360) - 180, -sun[1]];
        const night = d3.geoCircle().center(nightCenter).radius(89.5)();
        context.beginPath();
        path(night);
        context.fillStyle = "rgba(18, 13, 38, 0.55)";
        context.fill();
        context.beginPath();
        path(night);
        context.strokeStyle = "rgba(212, 82, 54, 0.45)";
        context.lineWidth = 1.15;
        context.stroke();
      }

      for (const sample of environmentRef.current) {
        if (!visible(sample.coords)) continue;
        const point = projection(sample.coords);
        if (!point) continue;
        if (layerRef.current.has("waves") && sample.waveHeightM !== undefined) {
          const waveRadius = 3 + Math.min(sample.waveHeightM, 8) * 1.35;
          context.save();
          context.translate(point[0], point[1]);
          context.rotate(((sample.waveDirection ?? 290) - 90) * Math.PI / 180);
          for (let crest = 0; crest < 3; crest += 1) {
            const phase = (now / 900 + crest * 2.1) % 6;
            context.beginPath();
            context.arc(-phase, crest * 2.4 - 2.4, waveRadius + phase, Math.PI * 0.08, Math.PI * 0.88);
            context.strokeStyle = `rgba(190, 219, 226, ${0.5 - crest * 0.11})`;
            context.lineWidth = 0.9 + crest * 0.25;
            context.stroke();
          }
          context.restore();
        }
        if (layerRef.current.has("winds") && sample.windDirection !== undefined && sample.windSpeedKn !== undefined) {
          const direction = (sample.windDirection + 180) * Math.PI / 180;
          const length = 5 + Math.min(sample.windSpeedKn, 40) * 0.3;
          for (let wisp = 0; wisp < 3; wisp += 1) {
            const drift = ((now / (64 + wisp * 9)) + wisp * 4.1) % Math.max(1, length * 1.6);
            const lateral = (wisp - 1) * 3.2;
            const x0 = point[0] - Math.sin(direction) * (length / 2 - drift * 0.22) + Math.cos(direction) * lateral;
            const y0 = point[1] + Math.cos(direction) * (length / 2 - drift * 0.22) + Math.sin(direction) * lateral;
            const x1 = x0 + Math.sin(direction) * length;
            const y1 = y0 - Math.cos(direction) * length;
            context.beginPath();
            context.moveTo(x0, y0);
            context.bezierCurveTo(
              x0 + Math.sin(direction) * length * 0.35 + Math.cos(direction) * 3.2,
              y0 - Math.cos(direction) * length * 0.35 + Math.sin(direction) * 3.2,
              x0 + Math.sin(direction) * length * 0.72 - Math.cos(direction) * 2.1,
              y0 - Math.cos(direction) * length * 0.72 - Math.sin(direction) * 2.1,
              x1, y1,
            );
            context.strokeStyle = `rgba(235, 229, 194, ${0.72 - wisp * 0.16})`;
            context.lineWidth = 1.35 - wisp * 0.2;
            context.lineCap = "round";
            context.stroke();
          }
        }
        if (layerRef.current.has("currents") && sample.currentDirection !== undefined && sample.currentSpeedKmh !== undefined) {
          const direction = sample.currentDirection * Math.PI / 180;
          const length = 4 + Math.min(sample.currentSpeedKmh, 8) * 1.4;
          const currentX0 = point[0] - Math.sin(direction) * length / 2;
          const currentY0 = point[1] + Math.cos(direction) * length / 2;
          const currentX1 = point[0] + Math.sin(direction) * length / 2;
          const currentY1 = point[1] - Math.cos(direction) * length / 2;
          context.beginPath();
          context.moveTo(currentX0, currentY0);
          context.quadraticCurveTo(point[0] + Math.cos(direction) * 3, point[1] + Math.sin(direction) * 3, currentX1, currentY1);
          context.strokeStyle = "rgba(116, 210, 184, 0.68)";
          context.lineWidth = 1.65;
          context.lineCap = "round";
          context.stroke();
          const spirit = 2.5 + Math.sin(now / 620 + point[0]) * 1.1;
          context.beginPath();
          context.arc(currentX1, currentY1, spirit, direction - 1.8, direction + 1.1);
          context.strokeStyle = "rgba(140, 222, 196, 0.42)";
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      const intelligenceField = intelligenceRef.current;
      if (layerRef.current.has("sea-ice") && intelligenceField) {
        for (const [lon, lat, concentration] of intelligenceField.seaIce.points) {
          if (!visible([lon, lat])) continue;
          const point = projection([lon, lat]);
          if (!point) continue;
          const alpha = 0.16 + concentration / 260;
          context.fillStyle = `rgba(226, 239, 221, ${Math.min(0.62, alpha)})`;
          context.beginPath();
          context.arc(point[0], point[1], 1.85, 0, Math.PI * 2);
          context.fill();
        }
      }

      if (layerRef.current.has("piracy") && intelligenceField) {
        const incidentColors: Record<string, string> = {
          attempted: "#E9C46A",
          boarded: "#F08D68",
          "fired-upon": "#EF6A67",
          hijacked: "#F1D2C7",
          suspicious: "#AEBAC2",
          reported: "#F08D68",
        };
        for (const incident of intelligenceField.piracy.incidents) {
          if (!visible(incident.coords)) continue;
          const point = projection(incident.coords);
          if (!point) continue;
          context.save();
          context.translate(point[0], point[1]);
          context.rotate(Math.PI / 4);
          const incidentColor = incidentColors[incident.category] ?? "#F08D68";
          context.shadowColor = incidentColor;
          context.shadowBlur = 8;
          context.fillStyle = rgba(incidentColor, 0.92);
          context.fillRect(-3.1, -3.1, 6.2, 6.2);
          context.restore();
        }
      }

      if (layerRef.current.has("dark-vessels") && sarRef.current) {
        for (const detection of sarRef.current.detections) {
          const coords: [number, number] = [detection.lon, detection.lat];
          if (!visible(coords)) continue;
          const point = projection(coords);
          if (!point) continue;
          const size = 2.5 + Math.min(3, Math.sqrt(detection.detections));
          context.beginPath();
          context.moveTo(point[0] - size, point[1]);
          context.lineTo(point[0] + size, point[1]);
          context.moveTo(point[0], point[1] - size);
          context.lineTo(point[0], point[1] + size);
          context.strokeStyle = "rgba(244, 168, 104, 0.68)";
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      if (layerRef.current.has("world-wake") && worldWakeRef.current) {
        context.save();
        context.globalCompositeOperation = "lighter";
        for (const cell of worldWakeRef.current.cells) {
          const coords: [number, number] = [cell.lon, cell.lat];
          if (!visible(coords)) continue;
          const point = projection(coords);
          if (!point) continue;
          const shimmer = 0.9 + Math.sin(now / 1900 + cell.lon * 0.08 + cell.lat * 0.13) * 0.1;
          const width = (9 + cell.intensity * 35) * shimmer;
          const height = width * 0.6;
          context.globalAlpha = Math.min(0.9, 0.18 + cell.intensity * 0.7);
          context.drawImage(wakeSprite, point[0] - width / 2, point[1] - height / 2, width, height);
          if (cell.intensity > 0.72) {
            const starSize = 4 + cell.intensity * 9;
            context.globalAlpha = 0.32 + cell.intensity * 0.38;
            context.drawImage(wakeStarSprite, point[0] - starSize, point[1] - starSize * 0.36, starSize * 2, starSize * 0.72);
          }
        }
        context.globalAlpha = 1;
        context.restore();
      }

      if (layerRef.current.has("delayed-voyages") && delayedVoyagePilotRef.current) {
        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        context.lineJoin = "round";
        for (const voyage of delayedVoyagePilotRef.current.candidates) {
          context.beginPath();
          let drawing = false;
          for (const fix of voyage.points) {
            const coords: [number, number] = [fix.lon, fix.lat];
            if (!visible(coords)) { drawing = false; continue; }
            const point = projection(coords);
            if (!point) { drawing = false; continue; }
            if (drawing) context.lineTo(point[0], point[1]); else context.moveTo(point[0], point[1]);
            drawing = true;
          }
          context.strokeStyle = "rgba(243, 210, 138, .24)";
          context.lineWidth = 1.15;
          context.stroke();
          const last = voyage.points.at(-1);
          if (last && visible([last.lon, last.lat])) {
            const point = projection([last.lon, last.lat]);
            if (point) context.drawImage(sprites.container, point[0] - 4, point[1] - 4, 8, 8);
          }
        }
        context.restore();
      }

      const vessels = layerRef.current.has("live-vessels") ? [...storeRef.current.values()] : [];
      for (const commodity of FILTERS) {
        if (!filterRef.current.has(commodity)) continue;
        context.beginPath();
        for (const vessel of vessels) {
          if (vessel.mmsi === selectedMmsi || vessel.commodity !== commodity || vessel.trail.length < 2) continue;
          const stride = Math.max(1, Math.ceil(vessel.trail.length / 60));
          let drawing = false;
          for (let index = 0; index < vessel.trail.length; index += stride) {
            const pointFix = vessel.trail[Math.min(index, vessel.trail.length - 1)];
            const coords: [number, number] = [pointFix[0], pointFix[1]];
            if (!visible(coords)) { drawing = false; continue; }
            const point = projection(coords);
            if (!point) { drawing = false; continue; }
            if (drawing) context.lineTo(point[0], point[1]); else context.moveTo(point[0], point[1]);
            drawing = true;
          }
        }
        context.strokeStyle = rgba(COLORS[commodity], 0.38);
        context.lineWidth = 0.9;
        context.lineCap = "round";
        context.stroke();
      }
      const selectedTrailVessel = selectedMmsi ? storeRef.current.get(selectedMmsi) : undefined;
      if (selectedTrailVessel && selectedTrailVessel.trail.length > 1) {
        const stride = Math.max(1, Math.ceil(selectedTrailVessel.trail.length / 240));
        context.beginPath();
        let drawing = false;
        for (let index = 0; index < selectedTrailVessel.trail.length; index += stride) {
          const fix = selectedTrailVessel.trail[Math.min(index, selectedTrailVessel.trail.length - 1)];
          const coords: [number, number] = [fix[0], fix[1]];
          if (!visible(coords)) { drawing = false; continue; }
          const point = projection(coords);
          if (!point) { drawing = false; continue; }
          if (drawing) context.lineTo(point[0], point[1]); else context.moveTo(point[0], point[1]);
          drawing = true;
        }
        context.strokeStyle = "rgba(244, 205, 129, .9)";
        context.lineWidth = 2.4;
        context.lineCap = "round";
        context.shadowColor = "rgba(240, 183, 87, .52)";
        context.shadowBlur = 7;
        context.stroke();
        context.shadowBlur = 0;
      }

      for (const chokepoint of layerRef.current.has("chokepoints") ? CHOKEPOINTS : []) {
        if (!visible(chokepoint.coords)) continue;
        const point = projection(chokepoint.coords);
        if (!point) continue;
        const pulse = 4 + Math.sin(now / 700 + chokepoint.coords[0]) * 1.5;
        context.beginPath();
        context.arc(point[0], point[1], pulse, 0, Math.PI * 2);
        context.strokeStyle = "rgba(247, 209, 126, 0.7)";
        context.lineWidth = 1.1;
        context.stroke();
        context.beginPath();
        context.moveTo(point[0] - pulse - 3, point[1]);
        context.lineTo(point[0] + pulse + 3, point[1]);
        context.moveTo(point[0], point[1] - pulse - 3);
        context.lineTo(point[0], point[1] + pulse + 3);
        context.strokeStyle = "rgba(247, 209, 126, 0.22)";
        context.lineWidth = 0.7;
        context.stroke();
      }

      if (layerRef.current.has("canal-restrictions") && intelligenceField) {
        const panama: [number, number] = [-79.68, 9.08];
        if (visible(panama)) {
          const point = projection(panama);
          if (point) {
            const restricted = intelligenceField.canal.advisories.filter((advisory) => ["draft", "outage", "navigation"].includes(advisory.category)).length;
            const pulse = 8 + Math.sin(now / 600) * 2;
            context.beginPath();
            context.arc(point[0], point[1], pulse + Math.min(6, restricted), 0, Math.PI * 2);
            context.setLineDash([2, 3]);
            context.strokeStyle = "rgba(240, 141, 104, 0.72)";
            context.lineWidth = 1.15;
            context.stroke();
            context.setLineDash([]);
          }
        }
      }

      for (const port of layerRef.current.has("live-vessels") ? PORT_SANCTUARIES : []) {
        if (!visible(port.coords)) continue;
        const point = projection(port.coords);
        if (!point) continue;
        const isHorizon = inferredDestination?.locode === port.locode;
        const pulse = 7 + Math.sin(now / 900 + port.coords[0]) * 1.4;
        context.save();
        context.translate(point[0], point[1]);
        context.rotate(Math.PI / 4);
        context.beginPath();
        context.arc(0, 0, isHorizon ? pulse + 4 : pulse, 0.15, Math.PI * 1.52);
        context.strokeStyle = rgba(port.accent, isHorizon ? 0.84 : 0.35);
        context.lineWidth = isHorizon ? 1.45 : 0.75;
        context.stroke();
        context.beginPath();
        context.moveTo(0, -4.3);
        context.lineTo(1.4, -1.2);
        context.lineTo(4.3, 0);
        context.lineTo(1.4, 1.2);
        context.lineTo(0, 4.3);
        context.lineTo(-1.4, 1.2);
        context.lineTo(-4.3, 0);
        context.lineTo(-1.4, -1.2);
        context.closePath();
        context.fillStyle = port.accent;
        context.shadowColor = port.accent;
        context.shadowBlur = isHorizon ? 22 : 12;
        context.fill();
        context.restore();
        context.shadowBlur = 0;
        if (isHorizon || zoomRef.current > 1.42) {
          context.fillStyle = "rgba(242, 222, 179, 0.82)";
          context.font = `${isHorizon ? 10 : 8}px Georgia, serif`;
          context.fillText(port.name, point[0] + 11, point[1] - 8);
        }
        if (layerRef.current.has("port-congestion")) {
          const nearby = portCongestionRef.current.get(port.locode) ?? 0;
          if (nearby > 0) {
            context.beginPath();
            context.arc(point[0], point[1], 5 + Math.sqrt(nearby) * 2.5, 0, Math.PI * 2);
            context.strokeStyle = "rgba(240, 141, 104, 0.46)";
            context.lineWidth = 1;
            context.stroke();
          }
        }
      }

      const hits: Array<{ mmsi: string; x: number; y: number }> = [];
      for (const vessel of vessels) {
        const fix = vessel.lastFix;
        if (!fix || !filterRef.current.has(vessel.commodity ?? "unknown")) continue;
        const age = wallNow - fix.receivedAt;
        if (age > 3_600_000) continue;
        const target = deadReckonedPosition(fix, wallNow);
        const current = vessel.renderedPosition ?? target;
        vessel.renderedPosition = [
          current[0] + (target[0] - current[0]) * Math.min(1, elapsed * 2.6),
          current[1] + (target[1] - current[1]) * Math.min(1, elapsed * 2.6),
        ];
        if (!visible(vessel.renderedPosition)) continue;
        const point = projection(vessel.renderedPosition);
        if (!point) continue;
        const fade = age < 600_000 ? 1 : Math.max(0.08, 1 - (age - 600_000) / 3_000_000);
        const selected = selectedMmsi === vessel.mmsi;
        const size = selected ? 38 : 26;
        const loadOpacity = layerRef.current.has("load-state") && vessel.loadState === "ballast" ? 0.5 : 0.95;
        context.globalAlpha = fade * loadOpacity;
        context.drawImage(sprites[vessel.commodity ?? "unknown"], point[0] - size / 2, point[1] - size / 2, size, size);
        context.globalAlpha = 1;
        if (selected) {
          context.beginPath();
          context.arc(point[0], point[1], 9, 0, Math.PI * 2);
          context.strokeStyle = "rgba(255,255,255,0.85)";
          context.lineWidth = 0.8;
          context.stroke();
        }
        if (layerRef.current.has("ais-gaps") && age >= 600_000) {
          context.beginPath();
          context.setLineDash([2, 3]);
          context.arc(point[0], point[1], 12, 0, Math.PI * 2);
          context.strokeStyle = "rgba(240, 141, 104, 0.66)";
          context.lineWidth = 0.9;
          context.stroke();
          context.setLineDash([]);
        }
        hits.push({ mmsi: vessel.mmsi, x: point[0], y: point[1] });
      }
      hitRef.current = hits;
      context.restore();

      context.beginPath();
      path({ type: "Sphere" });
      context.strokeStyle = "rgba(244, 210, 149, 0.52)";
      context.lineWidth = 1.25;
      context.stroke();

      const halo = context.createRadialGradient(centerX, centerY, radius * 0.96, centerX, centerY, radius * 1.12);
      halo.addColorStop(0, "rgba(246, 200, 125, 0.13)");
      halo.addColorStop(0.48, "rgba(123, 167, 188, 0.06)");
      halo.addColorStop(1, "rgba(85, 114, 158, 0)");
      context.beginPath();
      context.arc(centerX, centerY, radius * 1.12, 0, Math.PI * 2);
      context.fillStyle = halo;
      context.fill();
    };

    animation = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(animation);
  }, [dimensions, selectedMmsi]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    movedRef.current = false;
    pointerRef.current = [event.clientX, event.clientY];
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    const [lastX, lastY] = pointerRef.current;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) movedRef.current = true;
    rotationRef.current = [
      rotationRef.current[0] + dx * 0.24 / zoomRef.current,
      Math.max(-75, Math.min(75, rotationRef.current[1] - dy * 0.24 / zoomRef.current)),
    ];
    pointerRef.current = [event.clientX, event.clientY];
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (!movedRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const closest = hitRef.current
        .map((hit) => ({ ...hit, distance: Math.hypot(hit.x - x, hit.y - y) }))
        .filter((hit) => hit.distance < 12)
        .sort((a, b) => a.distance - b.distance)[0];
      const nextMmsi = closest?.mmsi ?? null;
      setSelectedMmsi(nextMmsi);
      setSelected(nextMmsi ? storeRef.current.get(nextMmsi) : undefined);
    }
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomRef.current = Math.max(0.78, Math.min(2.2, zoomRef.current * Math.exp(-event.deltaY * 0.001)));
  }, []);

  const toggleFilter = (commodity: Commodity) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(commodity)) next.delete(commodity); else next.add(commodity);
      return next;
    });
  };

  const toggleLayer = (id: LayerId) => {
    const definition = DATA_LAYERS.find((layer) => layer.id === id);
    const credentialReady = (id === "dark-vessels" && sarStatus === "live")
      || (id === "world-wake" && worldWakeStatus === "live")
      || (id === "delayed-voyages" && delayedVoyageStatus === "live");
    if (!definition || definition.locked || (definition.status !== "active" && !credentialReady)) return;
    setLayers((current) => {
      const next = new Set(current);
      const enabling = !next.has(id);
      if (!enabling) next.delete(id); else next.add(id);
      if (id === "live-vessels" && !enabling) {
        setSelectedMmsi(null);
        setSelected(undefined);
        setStats({ vessels: 0, moving: 0, laden: 0, anchors: 0, gaps: 0, fintraffic: 0, kystverket: 0, counts: EMPTY_COUNTS });
      }
      setLayerMoment({ id, enabled: enabling });
      const focus = LAYER_GUIDE[id]?.focus;
      if (enabling && focus) {
        rotationRef.current = focus;
        autoRotateRef.current = false;
        setAutoRotate(false);
      }
      return next;
    });
  };

  const selectedDestination = useMemo(() => resolveDestination(selected?.destination), [selected?.destination]);
  const selectedTrailNm = useMemo(() => trailDistanceNm(selected?.trail ?? []), [selected?.trail]);
  const selectedWeather = useMemo(
    () => voyageWeather(selected, selectedDestination, environment),
    [selected, selectedDestination, environment],
  );
  const inferredDistanceNm = selected?.lastFix && selectedDestination
    ? d3.geoDistance([selected.lastFix.lon, selected.lastFix.lat], selectedDestination.coords) * 3440.065
    : undefined;

  return (
    <main className="app-shell" ref={shellRef}>
      <div className="sky-wash" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        aria-label="Interactive globe showing identified cargo-vessel paths from delayed hourly AIS observations"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <h1>CARGO CONSTELLATIONS</h1>
            <p>THE RECENT MEMORY OF GLOBAL TRADE</p>
          </div>
        </div>
        <nav className="world-nav" aria-label="Project navigation">
          <a href="/wiki">FIELD GUIDE</a>
          <button type="button" onClick={() => setSoundOn((value) => !value)} aria-pressed={soundOn}>
            <span className={soundOn ? "sound-glyph active" : "sound-glyph"} aria-hidden="true" />
            {soundOn ? "OCEAN ON" : "OCEAN OFF"}
          </button>
        </nav>
        <div className="clock-block">
          <span>OBSERVATION WINDOW</span>
          <strong>{delayedVoyagePilot?.dateRange ?? "− 4 DAYS"}</strong>
        </div>
      </header>

      {layers.has("delayed-voyages") && (
        <div className={`history-banner voyage-history ${delayedVoyageStatus}`}>
          <span className="voyage-glyph" aria-hidden="true" />
          {delayedVoyageStatus === "live" && delayedVoyagePilot
            ? `PRIMARY VIEW · ${delayedVoyagePilot.candidates.length} IDENTIFIED CARGO VOYAGES · ${delayedVoyagePilot.dateRange} · HOURLY GRIDDED AIS`
            : delayedVoyageStatus === "loading" ? "ASSEMBLING THE FOUR-DAY VOYAGE CONSTELLATIONS" : "DELAYED VOYAGE PILOT UNAVAILABLE"}
        </div>
      )}
      {layers.has("world-wake") && !layers.has("delayed-voyages") && (
        <div className={`history-banner ${worldWakeStatus}`}>
          <span className="wake-glyph" aria-hidden="true" />
          {worldWakeStatus === "live" && worldWake
            ? `CONTEXT ONLY · AGGREGATE TRAFFIC MEMORY · OBSERVED THROUGH ${worldWake.availableThrough} · NOT VESSEL ROUTES`
            : worldWakeStatus === "loading" ? "PREPARING THE AGGREGATE TRAFFIC MEMORY" : "AGGREGATE TRAFFIC MEMORY UNAVAILABLE"}
        </div>
      )}
      {layers.has("live-vessels") && (
        <div className={`source-banner ${connection}`}>
          <span className="status-dot" />
          {connection === "live" ? "RECEIVED AIS · FINLAND + NORWAY · SOLID TRAILS ARE OBSERVED" : connection === "connecting" ? "AWAKENING THE NORDIC RECEIVERS" : connection === "offline" ? "NORDIC AIS RELAY SLEEPING" : "LOCAL SYNTHETIC PREVIEW"}
        </div>
      )}

      <div className="map-verse" aria-hidden="true">
        <span>FIELD I · FOUR DAYS AGO</span>
        <p>Each gold constellation<br />belongs to one cargo ship.</p>
      </div>

      <aside className="data-rail">
        <section className="rail-section overview">
          <p className="eyebrow">DELAYED VOYAGE PILOT</p>
          <div className="primary-stat"><strong>{delayedVoyagePilot?.candidates.length.toLocaleString() ?? "···"}</strong><span>identified cargo vessels shown</span></div>
          <p className="wake-date">{delayedVoyagePilot ? <><strong>{delayedVoyagePilot.dateRange}</strong> · Singapore + Malacca Strait</> : "Gathering identity-preserving observations"}</p>
          <p className="coverage-explainer">Each gold line joins hourly gridded AIS observations for one identified vessel in time order. The view is delayed about four days; it is neither raw live AIS nor an inferred route.</p>
          {layers.has("live-vessels") && (
            <div className="live-sample-summary">
              <span>RECEIVER COVERAGE</span>
              <strong>Finland + Norway only</strong>
              <small>{stats.fintraffic} Finland · {stats.kystverket} Norway</small>
            </div>
          )}
        </section>

        {layers.has("live-vessels") && <section className="rail-section">
          <div className="section-heading"><p className="eyebrow">VESSEL LAYERS</p><span>{filters.size}/{FILTERS.length}</span></div>
          <div className="filter-list">
            {FILTERS.map((commodity) => (
              <button
                type="button"
                key={commodity}
                className={filters.has(commodity) ? "filter active" : "filter"}
                onClick={() => toggleFilter(commodity)}
                aria-pressed={filters.has(commodity)}
              >
                <i style={{ "--signal": COLORS[commodity] } as React.CSSProperties} />
                <span>{LABELS[commodity]}</span>
                <b>{stats.counts[commodity]}</b>
              </button>
            ))}
          </div>
        </section>}

        <section className="rail-section data-layers-section">
          <div className="section-heading">
            <p className="eyebrow">WORLD LAYERS</p>
            <span>{layers.size} on</span>
          </div>
          <div className="data-layer-list">
            {DATA_LAYERS.map((layer) => {
              const enabled = layers.has(layer.id);
              const environmental = ["winds", "waves", "currents"].includes(layer.id);
              const staticIntelligence = ["sea-ice", "canal-restrictions", "piracy", "commodity-prices"].includes(layer.id);
              const darkVessels = layer.id === "dark-vessels";
              const delayedWake = layer.id === "world-wake";
              const delayedVoyages = layer.id === "delayed-voyages";
              const state = delayedVoyages
                ? delayedVoyageStatus === "live" ? enabled ? "delayed" : "ready" : delayedVoyageStatus
                : darkVessels
                ? sarStatus === "live" ? enabled ? "on" : "ready" : sarStatus
                : delayedWake ? worldWakeStatus === "live" ? enabled ? "delayed" : "ready" : worldWakeStatus
                : layer.status === "active"
                  ? environmental && environmentStatus !== "live" ? environmentStatus
                    : staticIntelligence && intelligenceStatus !== "live" ? intelligenceStatus
                      : enabled ? "on" : "ready"
                  : layer.status === "credential" ? "key" : "adapter";
              const available = layer.status === "active" || (delayedVoyages && delayedVoyageStatus === "live") || (darkVessels && sarStatus === "live") || (delayedWake && worldWakeStatus === "live");
              return (
                <button
                  type="button"
                  key={layer.id}
                  className={`data-layer ${enabled ? "active" : ""} ${!available ? "pending" : ""}`}
                  onClick={() => toggleLayer(layer.id)}
                  disabled={!available || layer.locked}
                  aria-pressed={enabled}
                  title={`${layer.description} Source: ${layer.source}`}
                  style={{ "--layer-color": LAYER_GUIDE[layer.id]?.color ?? "#72E7D8" } as React.CSSProperties}
                >
                  <span className={`layer-state ${state}`}><span /></span>
                  <span className="layer-copy"><b>{layer.label}</b><small>{layer.source}</small></span>
                  <em>{state}</em>
                </button>
              );
            })}
          </div>
          <p className="layer-footnote">Gold identity-preserving voyages are primary. Live Nordic receivers, aggregate traffic, weather and intelligence remain optional context.</p>

          {(intelligence || worldWake || sar || delayedVoyagePilot) && ["delayed-voyages", "sea-ice", "canal-restrictions", "piracy", "commodity-prices", "world-wake", "dark-vessels"].some((id) => layers.has(id as LayerId)) && (
            <div className="intelligence-readouts" aria-label="Active intelligence layer details">
              {layers.has("delayed-voyages") && delayedVoyagePilot && (
                <div className="intel-readout voyage-readout">
                  <span>IDENTITY-PRESERVING PILOT</span>
                  <strong>{delayedVoyagePilot.qualifyingVessels.toLocaleString()} qualifying voyages</strong>
                  <small>{delayedVoyagePilot.rows.toLocaleString()} hourly cells · {delayedVoyagePilot.identifiedVessels.toLocaleString()} vessel IDs · showing {delayedVoyagePilot.candidates.length.toLocaleString()}</small>
                </div>
              )}
              {layers.has("sea-ice") && intelligence && (
                <div className="intel-readout">
                  <span>POLAR FIELD</span>
                  <strong>{intelligence.seaIce.observedAt}</strong>
                  <small>{intelligence.seaIce.points.length.toLocaleString()} sampled cells · ≥{intelligence.seaIce.thresholdPercent}% ice</small>
                </div>
              )}
              {layers.has("canal-restrictions") && intelligence && (
                <div className="intel-readout">
                  <span>PANAMA ADVISORIES</span>
                  <strong>{intelligence.canal.advisories.length} current notices</strong>
                  {intelligence.canal.advisories.slice(0, 2).map((advisory) => (
                    <a key={advisory.id} href={advisory.url} target="_blank" rel="noreferrer">{advisory.id} · {advisory.subject}</a>
                  ))}
                </div>
              )}
              {layers.has("piracy") && intelligence && (
                <div className="intel-readout">
                  <span>IMB REPORTED INCIDENTS</span>
                  <strong>{intelligence.piracy.incidents.length} in {new Date().getUTCFullYear()}</strong>
                  {intelligence.piracy.incidents.slice(0, 2).map((incident) => (
                    <small key={incident.id} title={incident.narrative}>{incident.id} · {incident.category} · {incident.occurredAt}</small>
                  ))}
                </div>
              )}
              {layers.has("dark-vessels") && sar && (
                <div className="intel-readout">
                  <span>UNMATCHED SAR</span>
                  <strong>{sar.detections.reduce((sum, detection) => sum + detection.detections, 0).toLocaleString()} detections</strong>
                  <small>{sar.dateRange} · not proof of deliberate AIS disablement</small>
                </div>
              )}
              {layers.has("world-wake") && worldWake && (
                <div className="intel-readout wake-readout">
                  <span>AGGREGATE TRAFFIC MEMORY · CONTEXT</span>
                  <strong>Observed through {worldWake.availableThrough}</strong>
                  <small>{worldWake.cells.length.toLocaleString()} sampled signals · relative cargo and carrier presence · not live positions</small>
                </div>
              )}
              {layers.has("commodity-prices") && intelligence && (
                <div className="market-readout">
                  <span>WORLD BANK · {intelligence.commodities.observedAt}</span>
                  <div className="market-grid">
                    {intelligence.commodities.commodities.map((commodity) => (
                      <div key={commodity.id}>
                        <small>{commodity.label.replace(", Arabica", "")}</small>
                        <strong>{formatPrice(commodity.value)}</strong>
                        <em className={(commodity.changePercent ?? 0) >= 0 ? "up" : "down"}>{commodity.changePercent !== null ? `${commodity.changePercent > 0 ? "+" : ""}${commodity.changePercent}%` : "—"}</em>
                      </div>
                    ))}
                  </div>
                  <small>Monthly USD benchmarks · not futures quotes</small>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rail-section rail-note">
          <p className="eyebrow">TRAVELER&apos;S KEY</p>
          <p>Gold constellations preserve one vessel&apos;s identity through hourly observations. Teal presence marks are aggregate context and cannot show a ship&apos;s path.</p>
          <div className="truth-key"><span className="gridded-line" />Delayed hourly AIS</div>
          <div className="truth-key"><span className="solid-line" />Received AIS</div>
          <div className="truth-key"><span className="brush-line" />Inferred horizon</div>
          <div className="truth-key"><span className="dotted-line" />Reference corridor</div>
          <small>Fintraffic · CC BY 4.0 · Kystverket · NLOD</small>
        </section>
      </aside>

      {layerMoment && LAYER_GUIDE[layerMoment.id] && (
        <div className={`layer-moment ${layerMoment.enabled ? "revealed" : "concealed"}`} role="status">
          <span className="layer-moment-swatch" style={{ "--moment-color": LAYER_GUIDE[layerMoment.id]?.color } as React.CSSProperties} />
          <div>
            <small>{layerMoment.enabled ? "LAYER REVEALED" : "LAYER CONCEALED"}</small>
            <strong>{DATA_LAYERS.find((layer) => layer.id === layerMoment.id)?.label}</strong>
            <p>{LAYER_GUIDE[layerMoment.id]?.cue}</p>
          </div>
          <button type="button" onClick={() => setLayerMoment(null)} aria-label="Dismiss layer explanation">×</button>
        </div>
      )}

      <div className="globe-controls">
        <button type="button" onClick={() => setAutoRotate((value) => !value)} aria-label={autoRotate ? "Pause globe rotation" : "Resume globe rotation"}>
          {autoRotate ? "Ⅱ" : "▶"}
        </button>
        <span>DRAG TO TURN · SCROLL TO APPROACH</span>
      </div>

      {layers.has("chokepoints") ? (
        <div className="chokepoint-key">
          <span />
          CHOKEPOINTS · SIX NEEDLES
        </div>
      ) : null}

      {selected && selected.lastFix && (
        <section className="vessel-card voyage-scroll" aria-live="polite">
          <button className="card-close" type="button" onClick={() => { setSelectedMmsi(null); setSelected(undefined); }} aria-label="Close vessel details">×</button>
          <div className="card-topline">
            <span className="vessel-signal" style={{ "--signal": COLORS[selected.commodity ?? "unknown"] } as React.CSSProperties} />
            <p>{selected.source === "live" ? "LIVE VOYAGE SCROLL" : "SYNTHETIC VOYAGE SCROLL"}</p>
          </div>
          <h2>{selected.name || `MMSI ${selected.mmsi}`}</h2>
          <p className="vessel-id">MMSI {selected.mmsi} · {selected.flag} · {selected.provider?.includes("Kystverket") ? "NORWEGIAN WATERS" : selected.provider?.includes("Fintraffic") ? "FINNISH WATERS" : "AIS"}</p>
          <div className="coordinates">
            <span>{formatCoordinate(selected.lastFix.lat, "N", "S")}</span>
            <span>{formatCoordinate(selected.lastFix.lon, "E", "W")}</span>
          </div>

          <div className="scroll-chapter received-chapter">
            <div className="chapter-heading"><span>I</span><div><small>RECEIVED CHRONICLE</small><strong>{formatTrailDuration(selected.trail)} of observed passage</strong></div></div>
            <div className="chronicle-line"><i style={{ width: `${Math.min(100, 12 + selected.trail.length / 5)}%` }} /></div>
            <div className="chronicle-facts">
              <div><small>FIXES KEPT</small><strong>{selected.trail.length}</strong></div>
              <div><small>DISTANCE DRAWN</small><strong>{selectedTrailNm < 10 ? selectedTrailNm.toFixed(1) : Math.round(selectedTrailNm)} <em>nm</em></strong></div>
              <div><small>NOW MAKING</small><strong>{selected.lastFix.sog.toFixed(1)} <em>kn</em></strong></div>
            </div>
          </div>

          <div className={`scroll-chapter horizon-chapter ${selectedDestination ? "resolved" : "unresolved"}`}>
            <div className="chapter-heading"><span>II</span><div><small>INFERRED HORIZON</small><strong>{selectedDestination?.name ?? "The destination is still a riddle"}</strong></div></div>
            {selectedDestination ? (
              <div className="sanctuary-copy">
                <i style={{ "--sanctuary": selectedDestination.accent } as React.CSSProperties} />
                <div><b>{selectedDestination.epithet}</b><p>{selectedDestination.region} · {selectedDestination.locode} · about {Math.round(inferredDistanceNm ?? 0).toLocaleString()} nm by great-circle</p></div>
              </div>
            ) : (
              <p className="unresolved-copy">AIS says “{selected.destination || "not reported"}”. No port is inferred until that free text resolves with confidence.</p>
            )}
          </div>

          <div className="scroll-chapter weather-chapter">
            <div className="chapter-heading"><span>III</span><div><small>WEATHER SPIRIT</small><strong>{selectedWeather?.name ?? "No sampled spirit nearby"}</strong></div></div>
            {selectedWeather && (
              <div className="weather-runes">
                <div><i className="wind-rune" /><small>WIND</small><strong>{selectedWeather.windSpeedKn?.toFixed(0) ?? "—"} kn</strong></div>
                <div><i className="wave-rune" /><small>SEA</small><strong>{selectedWeather.waveHeightM?.toFixed(1) ?? "—"} m</strong></div>
                <div><i className="current-rune" /><small>CURRENT</small><strong>{selectedWeather.currentSpeedKmh?.toFixed(1) ?? "—"} km/h</strong></div>
              </div>
            )}
          </div>

          <div className="voyage-row">
            <div><small>NAVIGATION</small><strong>{navStatusLabel(selected.lastFix.navStatus)}</strong></div>
            <div><small>LAST RECEIVED</small><strong>{formatAge(clock.getTime() - selected.lastFix.receivedAt)}</strong></div>
          </div>
          <div className="scroll-legend"><span><i className="received-mark" />Received</span><span><i className="inferred-mark" />Inferred</span><span><i className="context-mark" />Context</span></div>
          <p className="provenance-note">
            {selected.source === "mock" ? "All values in this scroll are simulated and shaped like real AIS messages." : `Position and solid trail are received truth from ${selected.provider ?? "AIS"}. The pale future path is an interpretive great-circle toward resolved destination text—not a filed voyage plan.`}
          </p>
        </section>
      )}

      <footer className="footer-note">
        <span>{["winds", "waves", "currents"].some((id) => layers.has(id as LayerId)) ? "THE LIVING WEATHER" : "THE RECEIVED PASSAGE"}</span>
        <p>{["winds", "waves", "currents"].some((id) => layers.has(id as LayerId)) ? "NOAA GFS and marine model samples via Open-Meteo · visualization only" : "Gold paths are ordered hourly AIS cells · Nordic solid trails are received AIS · teal is aggregate context"}</p>
      </footer>
    </main>
  );
}
