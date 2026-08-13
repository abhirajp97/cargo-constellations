import assert from "node:assert/strict";
import test from "node:test";
import { summarizeGfwVoyageProbe } from "../lib/gfw-voyage-probe.js";

test("GFW voyage probe requires twenty vessels with six moving ordered points", () => {
  const rows = Array.from({ length: 20 }, (_, vessel) => Array.from({ length: 6 }, (_, hour) => ({
    vesselId: `vessel-${vessel}`,
    mmsi: `200000${String(vessel).padStart(3, "0")}`,
    shipName: `CARGO ${vessel}`,
    vesselType: "cargo",
    date: `2026-08-09 ${String(hour).padStart(2, "0")}:00`,
    lat: 1 + vessel * 0.01,
    lon: 100 + hour * 0.1,
  }))).flat();

  const summary = summarizeGfwVoyageProbe(rows);
  assert.equal(summary.verdict, "pass");
  assert.equal(summary.identifiedVessels, 20);
  assert.equal(summary.qualifyingVessels, 20);
  assert.equal(summary.candidates[0].points.length, 6);
});

test("stationary heatmap cells do not qualify as voyages", () => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    vesselId: "stationary",
    date: `2026-08-09 ${String(hour).padStart(2, "0")}:00`,
    lat: 1.2,
    lon: 103.8,
  }));
  const summary = summarizeGfwVoyageProbe(rows);
  assert.equal(summary.verdict, "fail");
  assert.equal(summary.qualifyingVessels, 0);
});
