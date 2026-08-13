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

test("ranks long multi-day voyages and rejects impossible grid jumps", () => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    vesselId: "long-haul",
    date: `2026-08-${String(1 + Math.floor(hour / 6)).padStart(2, "0")} ${String((hour % 6) * 4).padStart(2, "0")}:00`,
    lat: 5 + hour * 0.08,
    lon: 60 + hour * 0.8,
  }));
  rows.splice(12, 0, {
    vesselId: "long-haul",
    date: "2026-08-03 00:00",
    lat: 70,
    lon: -140,
  });

  const summary = summarizeGfwVoyageProbe(rows, {
    minimumVessels: 1,
    minimumOrderedPoints: 18,
    minimumDistanceNm: 500,
    maximumSpeedKn: 48,
    rankBy: "distance",
  });

  assert.equal(summary.verdict, "pass");
  assert.equal(summary.candidates.length, 1);
  assert.equal(summary.candidates[0].points.length, 24);
  assert.ok(summary.candidates[0].distanceNm > 1_000);
  assert.ok(summary.candidates[0].points.every((point) => point.lat < 10));
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
