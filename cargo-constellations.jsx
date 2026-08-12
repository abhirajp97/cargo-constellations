import React, { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

/* ============================================================
   CARGO CONSTELLATIONS
   A living globe of global commodity shipping lanes — ports as
   stars, routes as constellation lines, vessels as points of
   light with bioluminescent wakes.

   Currently running on MOCK vessel data, generated locally and
   shaped to mirror real AIS fields (mmsi, speed, course, dest).

   TO WIRE IN REAL VESSELS:
     1. Get a free key at https://aisstream.io
     2. Open a websocket to wss://stream.aisstream.io/v0/stream
     3. Subscribe with a bounding box + your API key
     4. Each message gives you MMSI, lat/lon, SOG (speed),
        COG (course), destination
     5. Replace the ship-generation effect below with a hook that
        maintains a `ships` array in this same shape
        ({ id, mmsi, name, commodity, from, to, t, trail })
        fed by incoming websocket messages instead of the
        animation-loop's synthetic t += rate*dt.
   ============================================================ */

const PORTS = [
  { id: "shanghai", name: "Shanghai", coords: [121.47, 31.23], note: "World's busiest container port — metals & general cargo hub" },
  { id: "singapore", name: "Singapore", coords: [103.82, 1.29], note: "Central transshipment hub for Asia–Europe trade" },
  { id: "rotterdam", name: "Rotterdam", coords: [4.48, 51.92], note: "Europe's largest port — principal cocoa-grinding & metals gateway" },
  { id: "losangeles", name: "Los Angeles", coords: [-118.22, 33.75], note: "Largest US container gateway on the Pacific coast" },
  { id: "santos", name: "Santos", coords: [-46.33, -23.96], note: "Brazil's largest port — principal coffee export terminal" },
  { id: "valparaiso", name: "Valparaíso", coords: [-71.63, -33.05], note: "Chile's main copper concentrate export terminal" },
  { id: "callao", name: "Callao", coords: [-77.15, -12.05], note: "Peru's primary copper & mineral export port" },
  { id: "abidjan", name: "Abidjan", coords: [-4.03, 5.32], note: "World's largest cocoa bean export port" },
  { id: "tema", name: "Tema", coords: [0.02, 5.63], note: "Ghana's principal cocoa export terminal" },
  { id: "hochiminh", name: "Ho Chi Minh City", coords: [106.70, 10.77], note: "Vietnam's leading robusta coffee export gateway" },
  { id: "busan", name: "Busan", coords: [129.04, 35.10], note: "South Korea's largest port — metals & general cargo" },
  { id: "neworleans", name: "New Orleans", coords: [-90.06, 29.95], note: "Principal US Gulf grain export corridor" },
  { id: "mombasa", name: "Mombasa", coords: [39.66, -4.05], note: "East Africa's gateway port for coffee & general cargo" },
  { id: "qingdao", name: "Qingdao", coords: [120.38, 36.07], note: "Major Chinese copper concentrate import terminal" },
];
const PORTS_BY_ID = Object.fromEntries(PORTS.map((p) => [p.id, p]));

const ROUTES = [
  { from: "valparaiso", to: "qingdao", commodity: "copper", ships: 2 },
  { from: "callao", to: "shanghai", commodity: "copper", ships: 2 },
  { from: "abidjan", to: "rotterdam", commodity: "cacao", ships: 2 },
  { from: "tema", to: "rotterdam", commodity: "cacao", ships: 1 },
  { from: "santos", to: "rotterdam", commodity: "coffee", ships: 2 },
  { from: "hochiminh", to: "losangeles", commodity: "coffee", ships: 1 },
  { from: "mombasa", to: "rotterdam", commodity: "coffee", ships: 1 },
  { from: "neworleans", to: "rotterdam", commodity: "grain", ships: 2 },
  { from: "neworleans", to: "singapore", commodity: "grain", ships: 1 },
  { from: "busan", to: "losangeles", commodity: "metals", ships: 1 },
  { from: "qingdao", to: "losangeles", commodity: "metals", ships: 1 },
  { from: "singapore", to: "rotterdam", commodity: "general", ships: 1 },
];

const COMMODITY_COLORS = {
  copper: "#F2A65A",
  cacao: "#B5652E",
  coffee: "#D9A441",
  grain: "#E8D48B",
  metals: "#7FA8C9",
  general: "#4CE0D2",
};
const COMMODITY_LABELS = {
  copper: "Copper concentrate",
  cacao: "Cacao",
  coffee: "Coffee",
  grain: "Grain",
  metals: "Metals & general",
  general: "Mixed / transshipment",
};

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isVisible(coord, rotation) {
  const center = [-rotation[0], -rotation[1]];
  return d3.geoDistance(coord, center) < Math.PI / 2;
}

const NAME_A = ["Meridian", "Northern", "Southern", "Amber", "Coral", "Pacific", "Atlantic", "Silver", "Golden", "Restless", "Quiet", "Copper"];
const NAME_B = ["Trader", "Horizon", "Current", "Passage", "Voyager", "Runner", "Star", "Tide", "Drift", "Compass", "Wake", "Harbor"];
function makeShipName(seed) {
  return `MV ${NAME_A[seed % NAME_A.length]} ${NAME_B[(seed * 7) % NAME_B.length]}`;
}
function makeMMSI(seed) {
  return String(200000000 + ((seed * 9973) % 99999999)).padStart(9, "0");
}
function makeTonnage(seed) {
  return 15000 + ((seed * 3719) % 165000);
}

const btnStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid rgba(76,224,210,0.3)",
  background: "rgba(11,27,46,0.7)",
  color: "#DCEEF2",
  fontSize: 12,
  fontFamily: "'IBM Plex Mono', monospace",
  cursor: "pointer",
};

function ShipDetail({ ship }) {
  const from = PORTS_BY_ID[ship.from].name;
  const to = PORTS_BY_ID[ship.to].name;
  const pct = Math.round(ship.t * 100);
  const remainingHrs = Math.max(1, Math.round((1 - ship.t) * 240));
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, color: "#F4FBFA" }}>{ship.name}</div>
      <div>MMSI {ship.mmsi} · {ship.tonnage.toLocaleString()} DWT</div>
      <div>
        Cargo: <span style={{ color: COMMODITY_COLORS[ship.commodity] }}>{COMMODITY_LABELS[ship.commodity]}</span>
      </div>
      <div>{from} → {to}</div>
      <div>Voyage progress: {pct}% · ETA in ~{remainingHrs}h (sim)</div>
    </div>
  );
}
function PortDetail({ port }) {
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, color: "#F4FBFA" }}>{port.name}</div>
      <div style={{ maxWidth: 360 }}>{port.note}</div>
    </div>
  );
}

export default function CargoConstellations() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rotationRef = useRef([20, -20]);
  const draggingRef = useRef(false);
  const lastPointer = useRef([0, 0]);
  const autoRotateRef = useRef(true);
  const simSpeedRef = useRef(1);
  const shipsRef = useRef([]);
  const portsScreenRef = useRef([]);
  const shipsScreenRef = useRef([]);
  const selectedRef = useRef(null);

  const [dims, setDims] = useState({ w: 900, h: 600 });
  const [autoRotate, setAutoRotate] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [selected, setSelected] = useState(null);

  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { simSpeedRef.current = simSpeed; }, [simSpeed]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // init mock ships
  useEffect(() => {
    const ships = [];
    ROUTES.forEach((route, ri) => {
      const n = route.ships || 1;
      for (let i = 0; i < n; i++) {
        const seed = ri * 11 + i * 3 + 1;
        ships.push({
          id: `${route.from}-${route.to}-${i}`,
          mmsi: makeMMSI(seed),
          name: makeShipName(seed),
          tonnage: makeTonnage(seed),
          commodity: route.commodity,
          from: route.from,
          to: route.to,
          t: i / n + Math.random() * 0.05,
          baseRate: 0.018 + Math.random() * 0.012,
          trail: [],
        });
      }
    });
    shipsRef.current = ships;
  }, []);

  // responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = dims.w + "px";
    canvas.style.height = dims.h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const graticule = d3.geoGraticule10();
    let raf;
    let last = performance.now();

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (!draggingRef.current && autoRotateRef.current) {
        rotationRef.current = [rotationRef.current[0] + dt * 3, rotationRef.current[1]];
      }

      const scale = Math.max(Math.min(dims.w, dims.h) / 2 - 40, 60);
      const projection = d3
        .geoOrthographic()
        .translate([dims.w / 2, dims.h / 2])
        .scale(scale)
        .rotate(rotationRef.current)
        .clipAngle(90);
      const path = d3.geoPath(projection, ctx);

      ctx.clearRect(0, 0, dims.w, dims.h);

      // ocean sphere
      ctx.beginPath();
      path({ type: "Sphere" });
      const grad = ctx.createRadialGradient(dims.w / 2, dims.h / 2, scale * 0.1, dims.w / 2, dims.h / 2, scale * 1.05);
      grad.addColorStop(0, "#0B1B2E");
      grad.addColorStop(1, "#060B14");
      ctx.fillStyle = grad;
      ctx.fill();

      // graticule
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = "rgba(76,224,210,0.08)";
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // sphere edge
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = "rgba(76,224,210,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // faint route constellation lines
      ROUTES.forEach((route) => {
        const a = PORTS_BY_ID[route.from].coords;
        const b = PORTS_BY_ID[route.to].coords;
        const interp = d3.geoInterpolate(a, b);
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= 60; s++) {
          const pt = interp(s / 60);
          if (!isVisible(pt, rotationRef.current)) { started = false; continue; }
          const [x, y] = projection(pt);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexToRgba(COMMODITY_COLORS[route.commodity], 0.12);
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // ports
      const portsScreen = [];
      PORTS.forEach((p) => {
        if (!isVisible(p.coords, rotationRef.current)) return;
        const [x, y] = projection(p.coords);
        portsScreen.push({ ...p, x, y });
        const g = ctx.createRadialGradient(x, y, 0, x, y, 11);
        g.addColorStop(0, "rgba(242,166,90,0.85)");
        g.addColorStop(1, "rgba(242,166,90,0)");
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = "#F2D9B8"; ctx.fill();
      });
      portsScreenRef.current = portsScreen;

      // ships + wakes
      const shipsScreen = [];
      shipsRef.current.forEach((ship) => {
        ship.t += dt * ship.baseRate * simSpeedRef.current;
        if (ship.t > 1) { ship.t -= 1; ship.trail = []; }
        const a = PORTS_BY_ID[ship.from].coords;
        const b = PORTS_BY_ID[ship.to].coords;
        const pos = d3.geoInterpolate(a, b)(ship.t);
        ship.trail.push(pos);
        if (ship.trail.length > 26) ship.trail.shift();

        for (let i = 1; i < ship.trail.length; i++) {
          const p0 = ship.trail[i - 1], p1 = ship.trail[i];
          if (!isVisible(p0, rotationRef.current) || !isVisible(p1, rotationRef.current)) continue;
          const [x0, y0] = projection(p0), [x1, y1] = projection(p1);
          const alpha = (i / ship.trail.length) * 0.5;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
          ctx.strokeStyle = hexToRgba(COMMODITY_COLORS[ship.commodity], alpha);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        if (isVisible(pos, rotationRef.current)) {
          const [x, y] = projection(pos);
          shipsScreen.push({ ...ship, x, y });
          const isSel = selectedRef.current && selectedRef.current.type === "ship" && selectedRef.current.data.id === ship.id;
          const r = isSel ? 5 : 3;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          glow.addColorStop(0, hexToRgba(COMMODITY_COLORS[ship.commodity], 0.9));
          glow.addColorStop(1, hexToRgba(COMMODITY_COLORS[ship.commodity], 0));
          ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "#F4FBFA"; ctx.fill();
          if (isSel) {
            ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = "#F4FBFA"; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      });
      shipsScreenRef.current = shipsScreen;

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [dims]);

  const onPointerDown = useCallback((e) => {
    draggingRef.current = true;
    lastPointer.current = [e.clientX, e.clientY];
    e.target.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e) => {
    if (!draggingRef.current) return;
    const [lx, ly] = lastPointer.current;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    rotationRef.current = [
      rotationRef.current[0] + dx * 0.25,
      Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.25)),
    ];
    lastPointer.current = [e.clientX, e.clientY];
  }, []);
  const onPointerUp = useCallback(() => { draggingRef.current = false; }, []);

  const onClick = useCallback((e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let hit = null;
    for (const s of shipsScreenRef.current) {
      if (Math.hypot(s.x - x, s.y - y) < 10) { hit = { type: "ship", data: s }; break; }
    }
    if (!hit) {
      for (const p of portsScreenRef.current) {
        if (Math.hypot(p.x - x, p.y - y) < 12) { hit = { type: "port", data: p }; break; }
      }
    }
    setSelected(hit);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 560,
        background: "#060B14",
        overflow: "hidden",
        borderRadius: 16,
        fontFamily: "'Space Grotesk', ui-sans-serif, sans-serif",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onClick}
        style={{ display: "block", cursor: "grab", touchAction: "none" }}
      />

      <div style={{ position: "absolute", top: 20, left: 20, color: "#DCEEF2", pointerEvents: "none" }}>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>CARGO CONSTELLATIONS</div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
          mock vessel data · drag to rotate · click a light
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(COMMODITY_LABELS).map(([k, label]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COMMODITY_COLORS[k], boxShadow: `0 0 8px ${COMMODITY_COLORS[k]}` }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "absolute", top: 20, right: 20, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
        <button onClick={() => setAutoRotate((a) => !a)} style={btnStyle}>
          {autoRotate ? "Pause rotation" : "Resume rotation"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#8FB6BE", fontFamily: "'IBM Plex Mono', monospace" }}>sim speed</span>
          <input type="range" min="0.2" max="4" step="0.2" value={simSpeed} onChange={(e) => setSimSpeed(parseFloat(e.target.value))} />
        </div>
      </div>

      {selected && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            maxWidth: 400,
            padding: "14px 18px",
            borderRadius: 12,
            background: "rgba(11,27,46,0.85)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(76,224,210,0.25)",
            color: "#DCEEF2",
          }}
        >
          <button
            onClick={() => setSelected(null)}
            style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "#8FB6BE", cursor: "pointer", fontSize: 13 }}
          >
            ✕
          </button>
          {selected.type === "ship" ? <ShipDetail ship={selected.data} /> : <PortDetail port={selected.data} />}
        </div>
      )}
    </div>
  );
}
