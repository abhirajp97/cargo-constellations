# Cargo Constellations

An atmospheric globe of global shipping: ports as stars, vessels as points of light, and received AIS fixes as bioluminescent wakes.

The application runs in an explicitly labeled synthetic AIS mode by default. Synthetic messages use the same envelope decoder and vessel store as the live pipeline, so switching sources does not change the rendering model.

The globe also includes real Natural Earth bathymetry, Eurostat-derived maritime routing, a computed solar terminator, chokepoints, live sampled NOAA GFS wind and marine conditions, daily NSIDC sea ice, current Panama Canal advisories, current-year IMB piracy reports, and monthly World Bank commodity benchmarks. Global Fishing Watch SAR detections activate when its free token is configured on the relay.

The in-product Field Guide at `/wiki` documents the project's visual motivations, the path from radio message to rendered vessel, every layer's source and status, uncertainty boundaries, the Phase 6 roadmap, and a plain-language glossary. The globe uses an original dusk-atlas art direction: cel-painted land, ink-blue oceans, brush-like environmental fields, lantern vessels, firefly ports, explicit layer feedback, and optional generative ocean ambience.

## Local development

```bash
npm install
npm run dev
```

## Live AIS

1. Get a free key from [aisstream.io](https://aisstream.io).
2. Copy `.env.example` to `.env` and add the key.
3. Run `npm run ingest` in one terminal.
4. Run `npm run dev` in another.

The browser connects only to the local relay. The aisstream API key never enters client-side JavaScript. The relay begins with Singapore and Dover Strait bounding boxes; set `AIS_FULL_GLOBE=true` only after validating the pipeline.

See [docs/live-data-setup.md](docs/live-data-setup.md) for continuous hosting and [docs/data-layers.md](docs/data-layers.md) for the complete free-layer status map.

## Truth boundary

- `lastFix` is received ground truth.
- `renderedPosition` is a separate, smoothly reconciled display coordinate.
- Dead reckoning stops after ten minutes; stale vessels fade and are pruned after an hour.
- Destination, draught, and ETA are treated as reported fields, not guaranteed facts.
- Demonstration values are visibly labeled synthetic throughout the interface.
