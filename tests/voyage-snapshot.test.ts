import assert from "node:assert/strict";
import test from "node:test";
import { parseVoyageSnapshot } from "../lib/voyage-snapshot.js";

function snapshot() {
  return {
    observedAt: "2026-08-13T19:30:00.000Z",
    dateRange: "2026-08-05—2026-08-09",
    region: "Five major shipping corridors",
    source: "Global Fishing Watch 4Wings AIS presence",
    caveat: "Daily gridded observations are joined by vessel identity and do not describe the exact sailed track.",
    windowDays: 5,
    verdict: "pass",
    rows: 8000,
    identifiedVessels: 950,
    qualifyingVessels: 340,
    corridors: [
      { id: "north-atlantic", label: "North Atlantic", focus: [-35, 40], rows: 1600, identifiedVessels: 190, qualifyingVessels: 68, shown: 1, status: "live" },
      { id: "suez-arabian", label: "Suez to Arabian Sea", focus: [48, 18], rows: 1600, identifiedVessels: 190, qualifyingVessels: 68, shown: 1, status: "live" },
      { id: "indian-malacca", label: "Indian Ocean to Malacca", focus: [82, 6], rows: 1600, identifiedVessels: 190, qualifyingVessels: 68, shown: 1, status: "live" },
    ],
    candidates: [{
      vesselId: "vessel-1",
      mmsi: "123456789",
      name: "PASSAGE ONE",
      vesselType: "cargo",
      corridorId: "north-atlantic",
      corridorLabel: "North Atlantic",
      distanceNm: 1120.4,
      points: [
        { observedAt: "2026-08-05 00:00", lat: 35.1, lon: -72.2 },
        { observedAt: "2026-08-09 00:00", lat: 49.2, lon: -18.4 },
      ],
    }],
  };
}

test("accepts a bounded, complete durable voyage snapshot", () => {
  const parsed = parseVoyageSnapshot(snapshot());
  assert.equal(parsed.verdict, "pass");
  assert.equal(parsed.corridors.length, 3);
  assert.equal(parsed.candidates[0].distanceNm, 1120.4);
  assert.equal(parsed.candidates[0].points.length, 2);
});

test("rejects snapshots without usable vessel paths", () => {
  const malformed = snapshot();
  malformed.candidates[0].points = [{ observedAt: "not-a-date", lat: 35.1, lon: -72.2 }];
  assert.throws(() => parseVoyageSnapshot(malformed), /required voyage data/);
});

test("bounds untrusted arrays and numeric counters", () => {
  const oversized = snapshot();
  oversized.rows = Number.POSITIVE_INFINITY;
  oversized.candidates = Array.from({ length: 250 }, (_, index) => ({
    ...oversized.candidates[0],
    vesselId: `vessel-${index}`,
  }));
  const parsed = parseVoyageSnapshot(oversized);
  assert.equal(parsed.rows, 10_000_000);
  assert.equal(parsed.candidates.length, 180);
});
