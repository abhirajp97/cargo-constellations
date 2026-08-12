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
import { CHOKEPOINTS, PORTS, createMockAisSource } from "../lib/mock-ais";
import { ENVIRONMENT_SAMPLES, fetchEnvironment, type EnvironmentPoint } from "../lib/environment";
import { DATA_LAYERS, defaultLayerSet, type LayerId } from "../lib/layers";
import {
  fetchSarDetections,
  fetchStaticIntelligence,
  type SarSnapshot,
  type StaticIntelligence,
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
const LIVE_GRACE_PERIOD_MS = 45_000;

const LAYER_GUIDE: Partial<Record<LayerId, { color: string; cue: string; focus?: [number, number] }>> = {
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
  "dark-vessels": { color: "#F4A868", cue: "Crosses are radar vessel detections not matched to AIS—not proof of intent." },
  "canal-restrictions": { color: "#F08D68", cue: "A warm dashed pulse marks current Panama Canal advisories.", focus: [79.68, -9.08] },
  piracy: { color: "#FF765F", cue: "Warm diamonds are incidents reported to the IMB Piracy Reporting Centre.", focus: [-100, -8] },
  "commodity-prices": { color: "#E9C46A", cue: "Monthly public benchmarks appear in the adjacent reading panel." },
};

type LandGeometry = ReturnType<typeof feature> | null;
type BathymetryGeometry = { depth: number; geometry: LandGeometry };

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

export default function CargoConstellations() {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storeRef = useRef(new Map<string, Vessel>());
  const rotationRef = useRef<[number, number]>([-18, -18]);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pointerRef = useRef<[number, number]>([0, 0]);
  const autoRotateRef = useRef(true);
  const zoomRef = useRef(1);
  const hitRef = useRef<Array<{ mmsi: string; x: number; y: number }>>([]);
  const filterRef = useRef(new Set<Commodity>(FILTERS));
  const layerRef = useRef(defaultLayerSet());
  const landRef = useRef<LandGeometry>(null);
  const bathymetryRef = useRef<BathymetryGeometry[]>([]);
  const routesRef = useRef<unknown>(null);
  const environmentRef = useRef<EnvironmentPoint[]>(ENVIRONMENT_SAMPLES);
  const intelligenceRef = useRef<StaticIntelligence | null>(null);
  const sarRef = useRef<SarSnapshot | null>(null);
  const audioRef = useRef<{ context: AudioContext; sources: AudioScheduledSourceNode[] } | null>(null);
  const lastDrawRef = useRef(0);

  const [dimensions, setDimensions] = useState({ width: 1200, height: 760 });
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selected, setSelected] = useState<Vessel | undefined>();
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState(new Set<Commodity>(FILTERS));
  const [layers, setLayers] = useState(defaultLayerSet);
  const [clock, setClock] = useState(new Date(0));
  const wsUrl = AIS_WEBSOCKET_URL;
  const [connection, setConnection] = useState<"demo" | "connecting" | "live" | "offline">(wsUrl ? "connecting" : "demo");
  const [environmentStatus, setEnvironmentStatus] = useState<"loading" | "live" | "offline">("loading");
  const [intelligenceStatus, setIntelligenceStatus] = useState<"loading" | "live" | "offline">("loading");
  const [sarStatus, setSarStatus] = useState<"key" | "loading" | "live" | "offline">(wsUrl ? "loading" : "key");
  const [intelligence, setIntelligence] = useState<StaticIntelligence | null>(null);
  const [sar, setSar] = useState<SarSnapshot | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [layerMoment, setLayerMoment] = useState<{ id: LayerId; enabled: boolean } | null>(null);
  const [stats, setStats] = useState({ vessels: 0, moving: 0, laden: 0, anchors: 0, gaps: 0, counts: EMPTY_COUNTS });

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
    if (!wsUrl) return;
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
  }, [wsUrl]);

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
          setEnvironmentStatus("live");
        })
        .catch(() => { if (!stopped) setEnvironmentStatus("offline"); });
    };
    update();
    const timer = window.setInterval(update, 15 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
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
    let demo: ReturnType<typeof createMockAisSource> | undefined;
    let stopped = false;

    const startDemo = () => {
      if (stopped || demo) return;
      demo = createMockAisSource((message) => update(message, "mock"));
      setConnection("demo");
    };

    const stopDemo = () => {
      demo?.stop();
      demo = undefined;
      for (const [mmsi, vessel] of storeRef.current) {
        if (vessel.source === "mock") storeRef.current.delete(mmsi);
      }
    };

    const demoTimer = window.setTimeout(startDemo, LIVE_GRACE_PERIOD_MS);
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => { if (!demo) setConnection("connecting"); };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          const deltas = frame.type === "snapshot" || frame.type === "deltas" ? frame.vessels : [frame];
          let receivedPosition = false;
          for (const vessel of deltas as Vessel[]) {
            if (vessel.lastFix) receivedPosition = true;
            const existing = storeRef.current.get(vessel.mmsi);
            const nextTrail = [...(existing?.trail ?? [])];
            if (vessel.lastFix) {
              const last = nextTrail.at(-1);
              if (!last || last[0] !== vessel.lastFix.lon || last[1] !== vessel.lastFix.lat) {
                nextTrail.push([vessel.lastFix.lon, vessel.lastFix.lat, vessel.lastFix.receivedAt]);
              }
              if (nextTrail.length > 90) nextTrail.splice(0, nextTrail.length - 90);
            }
            storeRef.current.set(vessel.mmsi, {
              ...existing,
              ...vessel,
              source: "live",
              trail: nextTrail,
              renderedPosition: existing?.renderedPosition,
            });
          }
          if (receivedPosition) {
            window.clearTimeout(demoTimer);
            stopDemo();
            setConnection("live");
          }
        } catch { /* ignore malformed downstream frames */ }
      };
      socket.onclose = () => {
        if (!demo) setConnection("offline");
        retry = window.setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      window.clearTimeout(demoTimer);
      demo?.stop();
      socket?.close();
    };
  }, [wsUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const vessels = [...storeRef.current.values()].filter((vessel) => vessel.lastFix && now - vessel.lastFix.receivedAt < 3_600_000);
      const counts = { ...EMPTY_COUNTS };
      for (const vessel of vessels) counts[vessel.commodity ?? "unknown"] += 1;
      setStats({
        vessels: vessels.length,
        moving: vessels.filter((vessel) => (vessel.lastFix?.sog ?? 0) > 1).length,
        laden: vessels.filter((vessel) => vessel.loadState === "laden").length,
        anchors: vessels.filter((vessel) => [1, 5].includes(vessel.lastFix?.navStatus ?? -1)).length,
        gaps: vessels.filter((vessel) => vessel.lastFix && now - vessel.lastFix.receivedAt >= 600_000).length,
        counts,
      });
      setSelected(selectedMmsi ? storeRef.current.get(selectedMmsi) : undefined);
      setClock(new Date(now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [selectedMmsi]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sprites = Object.fromEntries(
      Object.entries(COLORS).map(([key, color]) => [key, makeGlowSprite(color)]),
    ) as Record<Commodity, HTMLCanvasElement>;
    const graticule = d3.geoGraticule10();
    let animation = 0;

    const frame = (now: number) => {
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
      const visible = (coordinate: [number, number]) => d3.geoDistance(coordinate, [-rotationRef.current[0], -rotationRef.current[1]]) < Math.PI / 2;

      context.clearRect(0, 0, dimensions.width, dimensions.height);

      context.save();
      context.beginPath();
      path({ type: "Sphere" });
      const ocean = context.createRadialGradient(centerX - radius * 0.34, centerY - radius * 0.38, radius * 0.03, centerX, centerY, radius * 1.08);
      ocean.addColorStop(0, "#496C87");
      ocean.addColorStop(0.26, "#284D6B");
      ocean.addColorStop(0.66, "#142E4B");
      ocean.addColorStop(1, "#09172C");
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
        landWash.addColorStop(0, "#A58B59");
        landWash.addColorStop(0.42, "#716F52");
        landWash.addColorStop(1, "#414E45");
        context.fillStyle = landWash;
        context.fill();
        context.strokeStyle = "rgba(240, 205, 132, 0.72)";
        context.lineWidth = 1.35;
        context.shadowColor = "rgba(230, 170, 83, 0.35)";
        context.shadowBlur = 7;
        context.stroke();
        context.shadowBlur = 0;
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
          context.rotate(-0.35);
          context.beginPath();
          context.arc(0, 0, waveRadius, Math.PI * 0.05, Math.PI * 0.9);
          context.strokeStyle = "rgba(185, 216, 227, 0.62)";
          context.lineWidth = 1.15;
          context.stroke();
          context.restore();
        }
        if (layerRef.current.has("winds") && sample.windDirection !== undefined && sample.windSpeedKn !== undefined) {
          const direction = (sample.windDirection + 180) * Math.PI / 180;
          const length = 5 + Math.min(sample.windSpeedKn, 40) * 0.3;
          const drift = (now / 55) % Math.max(1, length);
          const x0 = point[0] - Math.sin(direction) * (length / 2 - drift * 0.15);
          const y0 = point[1] + Math.cos(direction) * (length / 2 - drift * 0.15);
          const x1 = x0 + Math.sin(direction) * length;
          const y1 = y0 - Math.cos(direction) * length;
          context.beginPath();
          context.moveTo(x0, y0);
          context.quadraticCurveTo((x0 + x1) / 2 + Math.cos(direction) * 2.2, (y0 + y1) / 2 + Math.sin(direction) * 2.2, x1, y1);
          context.strokeStyle = "rgba(232, 233, 202, 0.74)";
          context.lineWidth = 1.25;
          context.lineCap = "round";
          context.stroke();
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

      const vessels = [...storeRef.current.values()];
      for (const vessel of vessels) {
        if (!vessel.lastFix || !filterRef.current.has(vessel.commodity ?? "unknown")) continue;
        const color = COLORS[vessel.commodity ?? "unknown"];
        for (let index = 1; index < vessel.trail.length; index += 1) {
          const first = vessel.trail[index - 1];
          const second = vessel.trail[index];
          if (!visible([first[0], first[1]]) || !visible([second[0], second[1]])) continue;
          const p0 = projection([first[0], first[1]]);
          const p1 = projection([second[0], second[1]]);
          if (!p0 || !p1) continue;
          const freshness = Math.max(0.03, 1 - (Date.now() - second[2]) / 120_000);
          context.beginPath();
          context.moveTo(p0[0], p0[1]);
          context.lineTo(p1[0], p1[1]);
          context.strokeStyle = rgba(color, freshness * 0.58);
          context.lineWidth = 1.15;
          context.lineCap = "round";
          context.stroke();
        }
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

      for (const port of PORTS) {
        if (!visible(port.coords)) continue;
        const point = projection(port.coords);
        if (!point) continue;
        context.beginPath();
        context.moveTo(point[0], point[1] - 4.3);
        context.lineTo(point[0] + 1.4, point[1] - 1.2);
        context.lineTo(point[0] + 4.3, point[1]);
        context.lineTo(point[0] + 1.4, point[1] + 1.2);
        context.lineTo(point[0], point[1] + 4.3);
        context.lineTo(point[0] - 1.4, point[1] + 1.2);
        context.lineTo(point[0] - 4.3, point[1]);
        context.lineTo(point[0] - 1.4, point[1] - 1.2);
        context.closePath();
        context.fillStyle = "#F7D88F";
        context.shadowColor = "#F7D88F";
        context.shadowBlur = 12;
        context.fill();
        context.shadowBlur = 0;
        if (layerRef.current.has("port-congestion")) {
          const nearby = vessels.filter((vessel) => {
            if (!vessel.lastFix || ![1, 5].includes(vessel.lastFix.navStatus)) return false;
            return d3.geoDistance(port.coords, [vessel.lastFix.lon, vessel.lastFix.lat]) * 3440.065 < 35;
          }).length;
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
        const age = Date.now() - fix.receivedAt;
        if (age > 3_600_000) continue;
        const target = deadReckonedPosition(fix, Date.now());
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
      animation = window.requestAnimationFrame(frame);
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
    const sarReady = id === "dark-vessels" && sarStatus === "live";
    if (!definition || definition.locked || (definition.status !== "active" && !sarReady)) return;
    setLayers((current) => {
      const next = new Set(current);
      const enabling = !next.has(id);
      if (!enabling) next.delete(id); else next.add(id);
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

  const clockText = useMemo(
    () => clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false }),
    [clock],
  );

  return (
    <main className="app-shell" ref={shellRef}>
      <div className="sky-wash" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        aria-label="Interactive globe showing AIS vessel positions"
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
            <p>THE LIVING EDGES OF GLOBAL TRADE</p>
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
          <span>UTC · {clock.toISOString().slice(0, 10)}</span>
          <strong>{clockText}</strong>
        </div>
      </header>

      <div className={`source-banner ${connection}`}>
        <span className="status-dot" />
        {connection === "live" ? "LIVE VOYAGES · AIS" : connection === "connecting" ? "AWAKENING THE HARBORS" : connection === "offline" ? "AIS RELAY SLEEPING" : "STORYBOOK DEMO · SYNTHETIC AIS"}
      </div>

      <div className="map-verse" aria-hidden="true">
        <span>FIELD I · THE OCEAN BETWEEN</span>
        <p>Every light, a voyage.<br />Every silence, a horizon.</p>
      </div>

      <aside className="data-rail">
        <section className="rail-section overview">
          <p className="eyebrow">VISIBLE VOYAGERS</p>
          <div className="primary-stat"><strong>{stats.vessels}</strong><span>vessels reporting</span></div>
          <div className="mini-grid">
            <div><strong>{stats.moving}</strong><span>under way</span></div>
            <div><strong>{stats.laden || "—"}</strong><span>{connection === "demo" ? "laden (sim)" : "laden est."}</span></div>
            <div><strong>{stats.anchors}</strong><span>anchor / moored</span></div>
            <div><strong>{stats.gaps}</strong><span>AIS gaps &gt;10m</span></div>
          </div>
        </section>

        <section className="rail-section">
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
        </section>

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
              const state = darkVessels
                ? sarStatus === "live" ? enabled ? "on" : "ready" : sarStatus
                : layer.status === "active"
                  ? environmental && environmentStatus !== "live" ? environmentStatus
                    : staticIntelligence && intelligenceStatus !== "live" ? intelligenceStatus
                      : enabled ? "on" : "ready"
                  : layer.status === "credential" ? "key" : "adapter";
              const available = layer.status === "active" || (darkVessels && sarStatus === "live");
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
          <p className="layer-footnote">Daily and monthly snapshots show their observation date. “Key” means the relay still needs a free provider token.</p>

          {intelligence && ["sea-ice", "canal-restrictions", "piracy", "commodity-prices", "dark-vessels"].some((id) => layers.has(id as LayerId)) && (
            <div className="intelligence-readouts" aria-label="Active intelligence layer details">
              {layers.has("sea-ice") && (
                <div className="intel-readout">
                  <span>POLAR FIELD</span>
                  <strong>{intelligence.seaIce.observedAt}</strong>
                  <small>{intelligence.seaIce.points.length.toLocaleString()} sampled cells · ≥{intelligence.seaIce.thresholdPercent}% ice</small>
                </div>
              )}
              {layers.has("canal-restrictions") && (
                <div className="intel-readout">
                  <span>PANAMA ADVISORIES</span>
                  <strong>{intelligence.canal.advisories.length} current notices</strong>
                  {intelligence.canal.advisories.slice(0, 2).map((advisory) => (
                    <a key={advisory.id} href={advisory.url} target="_blank" rel="noreferrer">{advisory.id} · {advisory.subject}</a>
                  ))}
                </div>
              )}
              {layers.has("piracy") && (
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
              {layers.has("commodity-prices") && (
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
          <p>Ports burn as fixed stars. Moving vessels leave received-fix trails; the light between fixes is dead-reckoned for no more than ten minutes.</p>
          <div className="truth-key"><span className="solid-line" />Received AIS</div>
          <div className="truth-key"><span className="dotted-line" />Rendered motion</div>
          <small>Finnish AIS: Fintraffic / digitraffic.fi · CC BY 4.0</small>
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

      <div className="chokepoint-key">
        <span />
        CHOKEPOINTS · SIX NEEDLES
      </div>

      {selected && selected.lastFix && (
        <section className="vessel-card" aria-live="polite">
          <button className="card-close" type="button" onClick={() => { setSelectedMmsi(null); setSelected(undefined); }} aria-label="Close vessel details">×</button>
          <div className="card-topline">
            <span className="vessel-signal" style={{ "--signal": COLORS[selected.commodity ?? "unknown"] } as React.CSSProperties} />
            <p>{selected.source === "live" ? "AIS VESSEL" : "SYNTHETIC AIS VESSEL"}</p>
          </div>
          <h2>{selected.name || `MMSI ${selected.mmsi}`}</h2>
          <p className="vessel-id">MMSI {selected.mmsi} · {selected.flag}</p>
          <div className="coordinates">
            <span>{formatCoordinate(selected.lastFix.lat, "N", "S")}</span>
            <span>{formatCoordinate(selected.lastFix.lon, "E", "W")}</span>
          </div>
          <div className="detail-grid">
            <div><small>SPEED OVER GROUND</small><strong>{selected.lastFix.sog.toFixed(1)} <em>kn</em></strong></div>
            <div><small>COURSE</small><strong>{Math.round(selected.lastFix.cog)}° <em>true</em></strong></div>
            <div><small>NAVIGATION</small><strong className="text-value">{navStatusLabel(selected.lastFix.navStatus)}</strong></div>
            <div><small>LAST RECEIVED</small><strong className="text-value">{formatAge(clock.getTime() - selected.lastFix.receivedAt)}</strong></div>
          </div>
          <div className="voyage-row">
            <div><small>AIS DESTINATION</small><strong>{selected.destination || "Not reported"}</strong></div>
            <div><small>DRAUGHT</small><strong>{selected.draught ? `${selected.draught.toFixed(1)} m` : "Not reported"}</strong></div>
          </div>
          <p className="provenance-note">
            {selected.source === "mock" ? "All values in this card are simulated and shaped like real AIS messages." : "Position is received truth. The glowing point is smoothly reconciled and briefly dead-reckoned between fixes."}
          </p>
        </section>
      )}

      <footer className="footer-note">
        <span>{["winds", "waves", "currents"].some((id) => layers.has(id as LayerId)) ? "THE LIVING WEATHER" : "COASTAL CONSTELLATIONS"}</span>
        <p>{["winds", "waves", "currents"].some((id) => layers.has(id as LayerId)) ? "NOAA GFS and marine model samples via Open-Meteo · visualization only" : "The oceans do not go dark because nothing is there. They go dark because radio has a horizon."}</p>
      </footer>
    </main>
  );
}
