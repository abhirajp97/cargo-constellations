# Cargo Constellations

An atmospheric globe of the recent memory of global shipping: four-day-delayed cargo presence as luminous ocean wakes, with optional regional live vessels as points of light.

The primary view is Global Fishing Watch's worldwide, approximately four-day-delayed cargo and carrier presence field. It is aggregate relative intensity rather than individual live positions. Fintraffic for Finnish waters and the Norwegian Coastal Administration's Kystverket stream remain available as an optional, explicitly regional live sample.

The globe also includes real Natural Earth bathymetry, Eurostat-derived maritime routing, a computed solar terminator, chokepoints, live sampled NOAA GFS wind and marine conditions, daily NSIDC sea ice, current Panama Canal advisories, current-year IMB piracy reports, and monthly World Bank commodity benchmarks. Global Fishing Watch SAR detections activate separately when its free token is configured on the relay.

The in-product Field Guide at `/wiki` documents the project's visual motivations, the path from radio message to rendered vessel, every layer's source and status, uncertainty boundaries, the Phase 6 roadmap, and a plain-language glossary. The globe uses an original mythic field-atlas art direction: watermark land, luminous ink-blue oceans, weather spirits, lantern vessels, named port sanctuaries, truthful received trails, a delayed global wake, and visibly inferred voyage horizons.

## Local development

```bash
npm install
npm run dev
```

## Live AIS

1. Run `npm run ingest` in one terminal. Fintraffic and Kystverket need no credentials.
2. Run `npm run dev` in another.
3. Optionally add an [aisstream.io](https://aisstream.io) key in `.env` for its configured Singapore and Dover coverage.

The browser connects only to the local relay. Provider credentials, when used, never enter client-side JavaScript. Overlapping receiver messages are merged by MMSI.

See [docs/live-data-setup.md](docs/live-data-setup.md) for continuous hosting and [docs/data-layers.md](docs/data-layers.md) for the complete free-layer status map.

## Truth boundary

- `lastFix` is received ground truth.
- `trail` keeps sampled received fixes for a rolling 24-hour window while the relay process remains alive.
- `renderedPosition` is a separate, smoothly reconciled display coordinate.
- Dead reckoning stops after ten minutes; stale vessels fade and are pruned after an hour.
- Destination, draught, and ETA are treated as reported fields, not guaranteed facts.
- A pale inferred horizon is a great-circle interpretation of confidently resolved destination text, never a filed route.
- Demonstration values are visibly labeled synthetic throughout the interface.
