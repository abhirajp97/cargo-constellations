# Cargo Constellations — Build Specification

**A live globe of global commodity shipping, built on real AIS data.**

This document is a handoff brief. It is written to be read by a strong coding model with minimal additional context, and by the human directing it. It covers what AIS is, where the data comes from, what the current prototype does and doesn't do, the target architecture, and a phased build plan.

---

## 0. Project intent

A wonder-layer first, an analytics tool second. The aesthetic reference points are *Breath of the Wild* and *Ghost of Tsushima* — atmospheric, exploratory, unhurried, legible without explanation. Ports are stars. Routes are constellation lines. Vessels are points of light with bioluminescent wakes.

The design constraint that follows from this: **every number on screen must be real, or visibly marked as not.** The wonder comes from knowing the ship you are watching is actually out there right now. A simulated ETA rendered in the same typeface as a real one destroys the whole effect.

The secondary goal is that this can later grow an action layer — freight arbitrage, ETA-based procurement timing — without a rewrite. That is an argument for getting the data model right early, even though nothing depends on it yet.

---

## 1. What AIS actually is

AIS (Automatic Identification System) is a **collision-avoidance protocol**, not a tracking product. Nearly every quirk in the data follows from that.

### The physical layer

Ships broadcast unencrypted digital packets over two marine VHF channels — **161.975 MHz (AIS1)** and **162.025 MHz (AIS2)** — using SOTDMA (Self-Organizing Time Division Multiple Access). Each minute is divided into 2,250 time slots. A transponder listens, claims a free slot, and announces in each transmission which slot it will use next. There is no central coordinator; the network self-organizes within VHF earshot.

Carriage is mandated under SOLAS for:
- All vessels over 300 gross tons on international voyages
- All cargo vessels over 500 GT
- All passenger vessels regardless of size

**Class A** transponders (commercial, 12.5 W) transmit position every **2–10 seconds** while underway, every 3 minutes at anchor. **Class B** (leisure and small craft, 2 W) transmit every **30 seconds** or so. Many fishing vessels carry Class B or nothing at all.

### The message types that matter

| Type | Name | Cadence | Key fields |
|---|---|---|---|
| 1, 2, 3 | Position Report (Class A) | 2–10 s underway | MMSI, lat, lon, SOG, COG, true heading, rate of turn, navigational status, timestamp |
| 5 | Static and Voyage Data | every 6 min | MMSI, IMO number, call sign, vessel name, ship type, dimensions (A/B/C/D offsets), **draught**, **destination**, ETA |
| 18, 19 | Position Report (Class B) | ~30 s | MMSI, lat, lon, SOG, COG |
| 24 | Static Data Report (Class B) | every 6 min | name, ship type, dimensions |
| 27 | Long-Range Position Report | every 3 min | Reduced-precision position, designed specifically for satellite reception |
| 4 | Base Station Report | — | Shore station position and UTC — useful for identifying terrestrial receivers |
| 9 | SAR Aircraft Position | — | Search-and-rescue aircraft |

**Terminology:**

- **MMSI** — Maritime Mobile Service Identity, 9 digits. The first three are the MID (Maritime Identification Digits), which encode flag state. `232xxxxxx` is UK, `477xxxxxx` is Hong Kong, `563xxxxxx` is Singapore. This is a free and reliable flag-state lookup requiring no external data.
- **IMO number** — 7 digits, permanent for the life of the hull. MMSI changes when a ship reflags; IMO does not. Use IMO as the join key against any external vessel database; use MMSI as the live-session key.
- **SOG** — Speed Over Ground, knots. **COG** — Course Over Ground, degrees true. Note COG ≠ heading; a ship in a crosscurrent is crabbing.
- **Navigational status** — an enum: `0` under way using engine, `1` at anchor, `2` not under command, `5` moored, `6` aground, `7` engaged in fishing, `8` under way sailing. Status `1` and `5` are how you compute port congestion.
- **Draught** — how deep the hull sits, in decimetres. Manually entered.

### The two fields that turn AIS into commodity intelligence

**Destination** is free text typed by a crew member. It is gloriously inconsistent: `ROTTERDAM`, `RTM`, `R'DAM`, `NLRTM`, `FOR ORDERS`, `SINGAPORE FOR ORDERS`, empty. Any product depending on it needs a normalizer — fuzzy-match against UN/LOCODE (the five-character port code standard, e.g. `NLRTM`, `CLVAP`, `CIABJ`). Expect a 60–80% hit rate on a naive matcher.

**Draught** compared against a vessel's known laden and ballast marks tells you **whether the ship is loaded**. A Capesize bulker leaving Valparaíso at 17.9 m is full of copper concentrate; the same hull at 8 m is steaming out empty. Directional flow — full one way, empty the other — becomes visible. This is the single highest-value derived signal in the dataset and it costs nothing extra.

---

## 2. How the data is sourced

### Terrestrial reception

VHF is line-of-sight. A shore-based receiver picks up transponders within roughly **40 nautical miles** of the coast. Coverage is therefore a thin rind around every populated coastline, and completely absent mid-ocean. Community and commercial networks (MarineTraffic operates 13,000+ stations) aggregate thousands of these receivers into a global-ish feed that is dense at ports and empty at sea.

### Satellite reception

VHF leaks upward as well as sideways, so a receiver in low Earth orbit can hear transponders. But satellite AIS inherits a structural problem from the protocol.

SOTDMA assumes everyone in earshot can hear everyone else, coordinating slot use within a ~40 nm bubble. A satellite footprint is **thousands of kilometres wide** and contains hundreds of independent bubbles that have no knowledge of each other, all reusing the same 2,250 slots. In congested waters — Malacca, the North Sea, the East China Sea — packets arrive on top of each other and mutually annihilate. Detection probability in the highest-traffic zones can be poor.

Mitigations used by constellation operators:
- **Spot-beam antennas** that narrow the effective footprint
- **Multi-channel and multi-antenna receivers**
- **Onboard signal processing** that de-collides overlapping bursts (this is why the good constellations are expensive)
- **Longer dwell time** and larger constellations for more passes
- **Message type 27**, added to the standard specifically for satellite: short, low-rate, on separate long-range channels

**Consequence for this project:** satellite AIS is not a continuous track. It is a series of fixes separated by minutes to hours depending on constellation density and latitude. Mid-Pacific you might get a fix every 20 minutes on a strong constellation, or every few hours on a thin one. Polar coverage is generally better (converging orbits); equatorial is worse.

### Provider landscape (as of 2026)

The market consolidated hard between 2023 and 2025. **Kpler** acquired MarineTraffic, FleetMon, and Spire Maritime. **S&P Global** acquired ORBCOMM's AIS business. exactEarth was absorbed by Spire in 2021. Independent large-scale providers went from roughly half a dozen to two conglomerates plus a fragmented tail.

| Provider | Coverage | Access | Notes |
|---|---|---|---|
| **aisstream.io** | Terrestrial | Free, WebSocket only | The right starting point. No paid tier. |
| **AISHub** | Terrestrial | Free, but requires contributing a receiver | Reciprocal data-sharing model |
| **Datalastic** | Terrestrial + some sat | Self-serve, from ~€99/mo | Has historical data and a REST API |
| **VesselFinder API** | Mixed | Credit-based | |
| **Kpler / Spire** | Satellite + terrestrial | Enterprise contract | Best open-ocean coverage; not self-serve |
| **S&P Global / ORBCOMM** | Satellite + terrestrial | Enterprise contract | ~8 min refresh claimed |
| **Global Fishing Watch** | AIS-derived + SAR | Free API, registration required | Excellent for dark-vessel work |

**Recommendation:** build entirely on aisstream.io. Do not buy satellite data for a wonder-layer. The coastal-only coverage is not a defect to be fixed — it produces a more honest and arguably more beautiful picture: the world lights up at its edges, and the oceans are genuinely dark and empty, which is what they are.

### aisstream.io connection specifics

- Endpoint: `wss://stream.aisstream.io/v0/stream`
- Auth: free API key obtained after registering (GitHub sign-in supported), passed **inside the subscription payload**, not as an HTTP header
- There is **no REST API**. WebSocket only. No historical backfill.
- On connect, send **exactly one** JSON subscription frame, and it must arrive **within 3 seconds** or the server closes the connection
- Subscription shape:
  ```json
  {
    "APIKey": "<key>",
    "BoundingBoxes": [[[25.83, -80.21], [25.60, -79.88]], [[33.77, -118.36], [33.67, -118.10]]],
    "FiltersShipMMSI": ["368207620", "367719770"],
    "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
  }
  ```
  `BoundingBoxes` is required. Boxes may overlap without duplicating data. The MMSI and message-type filters are optional.
- Full-globe subscription is `[[[-90, -180], [90, 180]]]`
- Every message is an envelope with three top-level fields: `MessageType`, `MetaData`, `Message`. The decoded payload sits under `Message`, keyed by its type.
- Known operational issue: the service has been reported to send disconnect frames periodically (every couple of minutes in some clients). **Implement reconnect with backoff and re-subscription from day one.** Do not treat a clean close as terminal.

---

## 3. Current prototype: what it is

The existing `cargo-constellations.jsx` is a React + d3 canvas orthographic globe. It is **entirely synthetic** — no `fetch`, no WebSocket, no API key anywhere in the file.

What it does:

- 14 hardcoded ports with lat/lon and a descriptive note
- 12 hardcoded routes with a commodity tag and a ship count
- 17 vessels generated at mount, each with a deterministic pseudo-MMSI, name, and tonnage derived from a seed integer
- Each vessel holds a scalar `t ∈ [0,1]`. Each animation frame: `t += dt * baseRate * simSpeed`. Position is `d3.geoInterpolate(portA, portB)(t)`. On `t > 1` it wraps to 0 and the vessel teleports back to origin.
- A 26-point trail buffer, cleared on wrap
- Click hit-testing against screen-space ship and port positions
- ETA readout is `(1 - t) * 240` hours, honestly labelled "(sim)"

**The structural problem to fix first:** position is *derived* from route + progress. With real AIS this inverts — **position is ground truth, and the route is something you infer.** A vessel must hold an actual coordinate plus a history buffer, not a `from`/`to`/`t` triple. Doing this refactor before wiring anything up will save a rewrite.

**Also missing:** there is no landmass rendered at all — only a sphere, a graticule, and lines. This reads as a deliberate aesthetic until you notice that the great-circle interpolation sends the New Orleans → Rotterdam lane across Georgia and the Carolinas, and Santos → Rotterdam through the Brazilian interior. Real routes are not geodesics.

---

## 4. Target architecture

```
┌─────────────────┐
│  aisstream.io   │  wss://stream.aisstream.io/v0/stream
└────────┬────────┘
         │ WebSocket (API key lives here, server-side only)
┌────────▼────────────────────────────────────────┐
│  Ingest service (Node / Bun)                    │
│                                                 │
│  • holds the single upstream connection         │
│  • reconnect + backoff + re-subscribe           │
│  • decodes envelopes, routes by MessageType     │
│  • merges into VesselStore: Map<mmsi, Vessel>   │
│  • throttles: emits deltas at fixed tick (1 Hz) │
│  • prunes vessels unseen for > N minutes        │
│  • optional: writes to Postgres/DuckDB for      │
│    history, port calls, replay                  │
└────────┬────────────────────────────────────────┘
         │ WebSocket fan-out (deltas, no key)
┌────────▼────────────────────────────────────────┐
│  Browser                                        │
│                                                 │
│  • client-side VesselStore mirror               │
│  • dead-reckoning interpolator (60 fps)         │
│  • render layer (canvas 2D → WebGL at scale)    │
│  • aggregation LOD: density field ↔ individuals │
└─────────────────────────────────────────────────┘
```

### Why a server proxy is non-negotiable

A browser-side connection puts the API key in client-side JavaScript. Beyond the obvious, one upstream connection serving N browser clients is also the only way this scales, and it's where you get to hold state across page reloads.

### The three implementation traps

**1. You need a state store, not a stream.**

`PositionReport` and `ShipStaticData` are separate message types arriving at different cadences. A vessel that has sent position but not static data is just a number with coordinates. Keep a `Map<mmsi, Vessel>` and merge on arrival — position updates coordinates, static data fills in name/type/destination/draught. Never assume a field is present.

**2. Dead-reckon between fixes.**

This is what makes it feel alive. Given position at time *t₀* plus SOG and COG, project forward each animation frame:

```
distance_nm  = SOG * (now - t₀) / 3600
new_position = geodesic_destination(lastFix, bearing = COG, distance = distance_nm)
```

Use a proper direct-geodesic solution (Vincenty, or `geographiclib`) for this. When the next real fix arrives, **reconcile smoothly** — lerp the rendered position toward truth over ~500 ms rather than snapping. Otherwise vessels freeze and jump.

Cap the extrapolation. After ~10 minutes with no fix, stop projecting and start fading the vessel out. After ~60 minutes, prune it. Extrapolating a stale fix for hours produces confident-looking fiction, which is precisely the failure mode this project is trying to avoid.

**3. Scale.**

17 objects now; live AIS is 300,000+ vessels globally, and even a filtered subscription will hand you tens of thousands. The current per-frame `ctx.createRadialGradient()` per ship will die somewhere around 2,000 vessels.

- **Immediate fix:** pre-render the glow sprite once to an offscreen canvas per commodity colour, then `drawImage` it. 10–50× faster.
- **Real fix:** move to WebGL. `deck.gl`'s `ScatterplotLayer` handles a million points and has a globe view (`_GlobeView`). `three.js` gives more control over atmosphere and post-processing if the aesthetic demands it.
- **Level of detail:** aggregate at low zoom into a density field; resolve to individual points as you zoom in. **The transition from nebula to individual stars is the experience.** Design for it explicitly rather than treating it as an optimization.

### Data model

```ts
type Vessel = {
  mmsi: string;               // session key
  imo?: string;               // join key for external data
  name?: string;
  callSign?: string;
  shipType?: number;          // AIS enum; 70-79 cargo, 80-89 tanker
  flag?: string;              // derived from MMSI MID prefix, free
  dimensions?: { a: number; b: number; c: number; d: number };

  // dynamic — ground truth
  lastFix: {
    lat: number;
    lon: number;
    sog: number;              // knots
    cog: number;              // degrees true
    heading?: number;
    navStatus: number;
    receivedAt: number;       // epoch ms — YOUR receipt time
    reportedAt?: number;      // AIS timestamp field, often unreliable
  };

  // voyage
  destination?: string;         // raw free text
  destinationLocode?: string;   // normalized, nullable
  draught?: number;             // metres
  eta?: string;                 // AIS ETA field, frequently garbage

  // derived
  loadState?: 'laden' | 'ballast' | 'unknown';
  commodity?: string;           // inferred, see §6

  // client-side only
  trail: Array<[lon: number, lat: number, t: number]>;  // ring buffer
  renderedPosition: [lon: number, lat: number];         // dead-reckoned, ≠ lastFix
};
```

Keep `lastFix` and `renderedPosition` distinct. Conflating them is how you lose the ability to tell truth from extrapolation.

---

## 5. Phased build plan

Each phase should produce something watchable. Do not batch.

### Phase 1 — Refactor for truth
- Invert the vessel model: position is ground truth, `from`/`to`/`t` is gone
- Add the `lastFix` / `renderedPosition` split
- Keep generating mock data, but generate it as **fake AIS messages in the real envelope shape**, fed through the real decoder path
- Add land: TopoJSON world-110m rendered as dark negative space
- *Outcome: identical-looking globe, correct architecture underneath*

### Phase 2 — Live ingest
- Node ingest service, single upstream WebSocket, reconnect with exponential backoff
- `VesselStore` with merge-on-arrival and TTL pruning
- Fan-out WebSocket to browser, delta frames at 1 Hz
- Client mirror + dead-reckoning interpolator
- **Start with two small bounding boxes** (e.g. the Singapore Strait and the Dover Strait) before opening to the world — you want to see whether the pipeline works before it's drinking from a firehose
- *Outcome: real ships, real motion, small area*

### Phase 3 — Scale and LOD
- Offscreen sprite for glow; then migrate to deck.gl or three.js
- Full-globe subscription
- Density-field aggregation at low zoom, individuals at high zoom, smooth transition
- Accumulation buffer for wakes: instead of a 26-point capped trail, fade a persistent layer slowly so that over a few minutes **the actual shipping lanes draw themselves out of the traffic.** A far better reveal than pre-drawing the routes.
- *Outcome: the whole world, at framerate*

### Phase 4 — Meaning
- Commodity inference (see §6)
- Draught-derived load state: laden vessels glow, ballast vessels dim
- Chokepoint layer: Suez, Panama, Malacca, Bab el-Mandeb, Hormuz, Gibraltar, Bosphorus. Global trade pinches through roughly eight needles; render them as bright knots.
- Port congestion: count vessels with navStatus 1 or 5 inside anchorage polygons, plot the 7-day trend
- Real clock: replace abstract "sim speed" with a time control in real units — "1 hour per second," "1 day per second" — and a live UTC timestamp on screen
- *Outcome: the globe means something*

### Phase 5 — Atmosphere
- Day/night terminator (computed from date and sub-solar point; highest atmosphere-per-line-of-code in the whole project)
- Weather: NOAA GFS wind fields, Copernicus Marine significant wave height, tropical cyclone tracks. A typhoon spinning up in the western Pacific while ships scatter around it is the most cinematic thing available to you.
- Ocean currents and bathymetry as a faint under-layer — the Kuroshio, the Gulf Stream
- Sound: low ocean drone, soft tone on port call completion. Neither BOTW nor Ghost of Tsushima works muted.
- *Outcome: the thing you actually wanted*

### Phase 6 — Optional action layer
- Price sidebar: LME copper, ICE cocoa, ICE coffee, CBOT wheat. Not on the globe — quiet, adjacent. Watching the cacao lanes out of Abidjan next to the cocoa futures price is where the wonder-layer starts becoming a tool.
- Freight rates: Baltic Dry Index, Freightos FBX
- Dark vessels: track AIS gaps, reappearances, and position discontinuities. Global Fishing Watch publishes an open API with AIS-derived data and SAR-based dark-vessel detections (Sentinel-1 radar sees hulls whether or not they broadcast). A trail that fades to nothing and resumes with a gap is both a real analytical signal and a striking visual.
- Port call detection → dwell time → historical ETA accuracy

---

## 6. Commodity inference

There is no commodity field in AIS. Cargo is inferred. Ranked by reliability:

1. **Route + vessel type + port terminal.** A Capesize bulker departing a berth at Valparaíso that is a known copper concentrate terminal is carrying copper. Requires a port-terminal polygon set, which you build incrementally by hand for the routes you care about. Highest confidence, lowest coverage.
2. **Ship type from AIS.** Message 5 carries a ship-type enum: 70–79 cargo, 80–89 tanker, 30 fishing. Coarse but free and universal.
3. **Origin port priors.** Abidjan and Tema are overwhelmingly cocoa. Santos is coffee and soy. Callao and Valparaíso are copper. New Orleans is grain. A port → dominant commodity lookup gets you most of the way for a visualization.
4. **Vessel size class.** Handysize / Supramax / Panamax / Capesize correlate with trade. Derivable from the dimension fields in message 5.

For a wonder-layer, (3) plus (2) is sufficient and honest — label it as *likely* cargo, not *known* cargo. For anything approaching an action layer you need (1) plus, eventually, customs and bill-of-lading data (Panjiva, ImportGenius — both commercial).

---

## 7. Additional data layers worth adding

Ordered roughly by wonder-per-unit-effort:

| Layer | Source | Cost | Notes |
|---|---|---|---|
| Landmass | Natural Earth / TopoJSON | Free | Fix first — routes currently cross continents |
| Maritime routing graph | `searoute`, marnet network | Free | Lanes bend around Africa, funnel through canals. The funneling is the beautiful part. |
| Day/night terminator | Computed (`suncalc`) | Free | Highest atmosphere per line of code |
| Chokepoints | Hand-defined polygons | Free | Eight needles that all global trade passes through |
| Load state | Derived from AIS draught | Free | Highest-value derived signal |
| Port congestion | Derived from navStatus | Free | The metric that made AIS analytics a business |
| Weather / wave height | NOAA GFS, Copernicus Marine | Free | Cinematic |
| Ocean currents, bathymetry | NOAA, GEBCO | Free | Depth in both senses |
| Dark vessels / SAR | Global Fishing Watch API | Free, registration | Sentinel-1 sees hulls that don't broadcast |
| Sea ice / Northern Sea Route | NSIDC | Free | Seasonal drama |
| Commodity prices | LME, ICE, CBOT | Varies; delayed feeds often free | Sidebar, not globe |
| Freight rates | Baltic Exchange, Freightos | Some free indices | |
| Canal transit restrictions | Panama Canal Authority | Free | Drought draft limits are visible in AIS draught data — a nice closed loop |
| Piracy / incidents | IMB Piracy Reporting Centre | Free | |
| Customs / bill of lading | Panjiva, ImportGenius | Commercial | Only if the action layer materializes |

---

## 8. Known gotchas

- **AIS is trivially spoofable and switchable.** Positions can be fabricated. Vessels go dark deliberately. Do not present AIS as truth without qualification; do present gaps as interesting.
- **The AIS `timestamp` field is unreliable.** Use your own receipt time as the authoritative clock. Keep the reported one for forensics.
- **Duplicate MMSIs exist.** Misconfigured transponders, deliberate cloning. If a single MMSI produces two positions 3,000 km apart in 60 seconds, that's a signal — but the store must not corrupt itself over it.
- **Destination is free text.** Budget real effort for the normalizer, or accept partial coverage.
- **ETA in AIS is frequently garbage** — stale, in the wrong year, or a placeholder. Compute your own from position, SOG, and destination.
- **Class B vessels are a large fraction of the count and a tiny fraction of the tonnage.** For a commodity visualization, filtering to ship types 70–89 cuts noise dramatically.
- **Bounding-box subscriptions do not include vessels that were already there before you connected.** You start with an empty world and it fills in over minutes. Either cache server-side (the argument for the DB layer in Phase 2) or design the cold start as a deliberate reveal.
- **Reconnect aggressively.** Assume the upstream connection will drop repeatedly. Backoff, re-subscribe, never lose local state on reconnect.
- **Coastal-only coverage is a feature.** Do not spend money fixing it until the thing is otherwise finished.

---

## 9. Reference

**Standards and data**
- ITU-R M.1371 — the AIS technical standard (message formats, SOTDMA)
- UN/LOCODE — port code standard, for destination normalization
- aisstream.io documentation — `https://aisstream.io/documentation`
- aisstream message models and example clients — `https://github.com/aisstream`
- Global Fishing Watch API — AIS-derived and SAR dark-vessel data
- Natural Earth — land, coastline, ports; GEBCO — bathymetry
- NOAA GFS / Copernicus Marine — weather, currents, sea state

**Libraries**
- `d3-geo` — projections, great-circle math, graticule
- `topojson-client` + `world-atlas` — land geometry
- `deck.gl` (`_GlobeView`) or `three.js` — WebGL rendering at scale
- `searoute-js` — maritime routing between ports
- `ws` — Node WebSocket client and server
- `suncalc` — solar position for the terminator
- `geographiclib` — accurate geodesic direct/inverse for dead reckoning

---

## Handoff note

If handing this to a coding model, the highest-leverage framing is:

> The critical constraint is that vessel position must be ground truth received from AIS, with dead-reckoned rendering held separately, and that no number displayed to the user may be simulated without being visibly marked as such. We can skip Phase 3 or keep it as something to add later, since that requires a subscription, but the rest, along with more data that is free, should be worked on asap.

Phases 3 onward benefit from having lived with the real data for a while first. The coverage pattern, the message cadence, and the messiness of the destination field will all change what you want to build.
