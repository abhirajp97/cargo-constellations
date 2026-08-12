# Free data-layer implementation map

The interface distinguishes **active**, **key required**, and **adapter required** layers. A visible switch never claims to be live before its source is connected.

| Layer | Source | Current state |
|---|---|---|
| Landmass | Natural Earth 110m | Active |
| Bathymetry | Natural Earth nested SRTM+ contours | Active at 200/1,000/3,000/5,000 m |
| Maritime routes | `searoute-js`, Eurostat-derived marnet | Active; visualization only |
| Day/night | Computed solar terminator | Active |
| Chokepoints | Curated coordinates | Active |
| Surface wind | NOAA GFS through Open-Meteo | Active, 15-minute refresh |
| Waves | NCEP GFS Wave / best-match marine models through Open-Meteo | Active, sampled field |
| Ocean currents | Météo-France SMOC through Open-Meteo | Active, sampled field |
| Load state | AIS draught plus vessel marks | Architecture active; live classification remains unknown without hull marks |
| Port congestion | AIS status near known ports | Active for current counts; seven-day trend needs persistence |
| AIS gaps | Local vessel history | Active; a gap is not labeled deliberate |
| SAR / dark vessels | Global Fishing Watch | Free account and bearer token required |
| Sea ice | NSIDC daily products | Adapter required for scheduled download, reprojection, and cache |
| Canal restrictions | Panama Canal Authority advisories | Adapter required for scheduled PDF parsing |
| Piracy | IMB Piracy Reporting Centre | Public map exists; no documented API, so permitted ingestion must be established |
| Commodity prices | Delayed exchange/vendor feeds | Provider and redistribution terms still need selection |
| Freight rates | Public index releases | Normalized redistributable source still needs selection |

## Why weather uses Open-Meteo

Direct NOAA GRIB and Copernicus multidimensional products are excellent source data but expensive to decode and reproject in a browser. Open-Meteo exposes current NOAA GFS wind, NCEP GFS Wave, ocean-current, and sea-surface fields as a simple coordinate API. The visualization remains sampled—not a navigational forecast—and names the underlying model family in the interface.

## Next persistence milestone

The relay needs a history store before these features can become honest time series:

- seven-day port congestion;
- vessel draught baselines and laden/ballast confidence;
- gap start/end events;
- port-call detection and dwell time;
- environmental replay aligned with vessel history.

Postgres with TimescaleDB is the conventional production choice. DuckDB or SQLite is sufficient for a single-instance research build.
