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

const COLORS: Record<Commodity, string> = {
  container: "#72E7D8",
  "dry-bulk": "#E9C46A",
  tanker: "#F08D68",
  general: "#8CB8E8",
  unknown: "#AEBAC2",
};

const LABELS: Record<Commodity, string> = {
  container: "Cargo / container",
  "dry-bulk": "Likely dry bulk",
  tanker: "Tanker",
  general: "General cargo",
  unknown: "Unclassified",
};

const FILTERS: Commodity[] = ["container", "dry-bulk", "tanker", "general"];

type LandGeometry = ReturnType<typeof feature> | null;

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
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.08, rgba(color, 0.95));
  gradient.addColorStop(0.35, rgba(color, 0.32));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 56, 56);
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
  const landRef = useRef<LandGeometry>(null);
  const lastDrawRef = useRef(0);
  const sourceRef = useRef<"mock" | "live">("mock");

  const [dimensions, setDimensions] = useState({ width: 1200, height: 760 });
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState(new Set<Commodity>(FILTERS));
  const [clock, setClock] = useState(new Date(0));
  const [connection, setConnection] = useState<"demo" | "connecting" | "live" | "offline">("demo");
  const [stats, setStats] = useState({ vessels: 0, moving: 0, laden: 0, anchors: 0 });

  const selected = selectedMmsi ? storeRef.current.get(selectedMmsi) : undefined;
  const wsUrl = process.env.NEXT_PUBLIC_AIS_WEBSOCKET_URL;

  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { filterRef.current = filters; }, [filters]);

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
    fetch("/land-110m.json")
      .then((response) => response.json())
      .then((world: Topology<{ land: GeometryCollection }>) => {
        landRef.current = feature(world, world.objects.land);
      })
      .catch(() => { landRef.current = null; });
  }, []);

  useEffect(() => {
    const update = (envelope: AisEnvelope, source: Vessel["source"]) => {
      const payload = envelope.Message?.[envelope.MessageType];
      const mmsi = String(payload?.UserID ?? payload?.MMSI ?? envelope.MetaData?.MMSI ?? "");
      const merged = mergeAisEnvelope(storeRef.current.get(mmsi), envelope, Date.now(), source);
      if (merged) storeRef.current.set(merged.mmsi, merged);
    };

    if (!wsUrl) {
      sourceRef.current = "mock";
      const mock = createMockAisSource((message) => update(message, "mock"));
      setConnection("demo");
      return () => mock.stop();
    }

    sourceRef.current = "live";
    setConnection("connecting");
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnection("live");
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          const deltas = frame.type === "snapshot" || frame.type === "deltas" ? frame.vessels : [frame];
          for (const vessel of deltas as Vessel[]) {
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
  }, [wsUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const vessels = [...storeRef.current.values()].filter((vessel) => vessel.lastFix && now - vessel.lastFix.receivedAt < 3_600_000);
      setStats({
        vessels: vessels.length,
        moving: vessels.filter((vessel) => (vessel.lastFix?.sog ?? 0) > 1).length,
        laden: vessels.filter((vessel) => vessel.loadState === "laden").length,
        anchors: vessels.filter((vessel) => [1, 5].includes(vessel.lastFix?.navStatus ?? -1)).length,
      });
      setClock(new Date(now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      const ocean = context.createRadialGradient(centerX - radius * 0.28, centerY - radius * 0.3, radius * 0.04, centerX, centerY, radius * 1.05);
      ocean.addColorStop(0, "#123641");
      ocean.addColorStop(0.55, "#09232D");
      ocean.addColorStop(1, "#031016");
      context.fillStyle = ocean;
      context.fill();
      context.clip();

      if (landRef.current) {
        context.beginPath();
        path(landRef.current as never);
        context.fillStyle = "#06161A";
        context.fill();
        context.strokeStyle = "rgba(132, 198, 190, 0.14)";
        context.lineWidth = 0.55;
        context.stroke();
      }

      context.beginPath();
      path(graticule);
      context.strokeStyle = "rgba(121, 209, 199, 0.07)";
      context.lineWidth = 0.55;
      context.stroke();

      const sun = sunPosition(new Date());
      const nightCenter: [number, number] = [((sun[0] + 180 + 540) % 360) - 180, -sun[1]];
      context.beginPath();
      path(d3.geoCircle().center(nightCenter).radius(89.5)());
      context.fillStyle = "rgba(1, 5, 10, 0.45)";
      context.fill();

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
          context.strokeStyle = rgba(color, freshness * 0.42);
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      for (const chokepoint of CHOKEPOINTS) {
        if (!visible(chokepoint.coords)) continue;
        const point = projection(chokepoint.coords);
        if (!point) continue;
        const pulse = 4 + Math.sin(now / 700 + chokepoint.coords[0]) * 1.5;
        context.beginPath();
        context.arc(point[0], point[1], pulse, 0, Math.PI * 2);
        context.strokeStyle = "rgba(235, 203, 126, 0.30)";
        context.lineWidth = 0.7;
        context.stroke();
      }

      for (const port of PORTS) {
        if (!visible(port.coords)) continue;
        const point = projection(port.coords);
        if (!point) continue;
        context.beginPath();
        context.arc(point[0], point[1], 1.6, 0, Math.PI * 2);
        context.fillStyle = "#F5DFAE";
        context.shadowColor = "#F5DFAE";
        context.shadowBlur = 9;
        context.fill();
        context.shadowBlur = 0;
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
        const color = COLORS[vessel.commodity ?? "unknown"];
        const selected = selectedMmsi === vessel.mmsi;
        const size = selected ? 38 : 26;
        context.globalAlpha = fade * (vessel.loadState === "ballast" ? 0.5 : 0.95);
        context.drawImage(sprites[vessel.commodity ?? "unknown"], point[0] - size / 2, point[1] - size / 2, size, size);
        context.globalAlpha = 1;
        if (selected) {
          context.beginPath();
          context.arc(point[0], point[1], 9, 0, Math.PI * 2);
          context.strokeStyle = "rgba(255,255,255,0.85)";
          context.lineWidth = 0.8;
          context.stroke();
        }
        hits.push({ mmsi: vessel.mmsi, x: point[0], y: point[1] });
      }
      hitRef.current = hits;
      context.restore();

      context.beginPath();
      path({ type: "Sphere" });
      context.strokeStyle = "rgba(119, 224, 209, 0.34)";
      context.lineWidth = 0.9;
      context.stroke();

      const halo = context.createRadialGradient(centerX, centerY, radius * 0.96, centerX, centerY, radius * 1.12);
      halo.addColorStop(0, "rgba(77, 220, 203, 0.07)");
      halo.addColorStop(0.55, "rgba(77, 220, 203, 0.025)");
      halo.addColorStop(1, "rgba(77, 220, 203, 0)");
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
      setSelectedMmsi(closest?.mmsi ?? null);
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

  const clockText = useMemo(
    () => clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false }),
    [clock],
  );

  return (
    <main className="app-shell" ref={shellRef}>
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
        <div className="clock-block">
          <span>UTC · {clock.toISOString().slice(0, 10)}</span>
          <strong>{clockText}</strong>
        </div>
      </header>

      <div className={`source-banner ${connection}`}>
        <span className="status-dot" />
        {connection === "live" ? "LIVE AIS" : connection === "connecting" ? "CONNECTING TO RELAY" : connection === "offline" ? "AIS RELAY OFFLINE" : "DEMONSTRATION · SYNTHETIC AIS"}
      </div>

      <aside className="data-rail">
        <section className="rail-section overview">
          <p className="eyebrow">FIELD OF VIEW</p>
          <div className="primary-stat"><strong>{stats.vessels}</strong><span>vessels reporting</span></div>
          <div className="mini-grid">
            <div><strong>{stats.moving}</strong><span>under way</span></div>
            <div><strong>{stats.laden || "—"}</strong><span>{sourceRef.current === "mock" ? "laden (sim)" : "laden est."}</span></div>
            <div><strong>{stats.anchors}</strong><span>anchored</span></div>
            <div><strong>{PORTS.length}</strong><span>port beacons</span></div>
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
                <b>{[...storeRef.current.values()].filter((vessel) => vessel.commodity === commodity).length}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section rail-note">
          <p className="eyebrow">READING THE FIELD</p>
          <p>Ports burn as fixed stars. Moving vessels leave received-fix trails; the light between fixes is dead-reckoned for no more than ten minutes.</p>
          <div className="truth-key"><span className="solid-line" />Received AIS</div>
          <div className="truth-key"><span className="dotted-line" />Rendered motion</div>
        </section>
      </aside>

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
          <button className="card-close" type="button" onClick={() => setSelectedMmsi(null)} aria-label="Close vessel details">×</button>
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
            <div><small>LAST RECEIVED</small><strong className="text-value">{formatAge(Date.now() - selected.lastFix.receivedAt)}</strong></div>
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
        <span>COASTAL AIS RECEPTION</span>
        <p>The oceans do not go dark because nothing is there. They go dark because radio has a horizon.</p>
      </footer>
    </main>
  );
}
