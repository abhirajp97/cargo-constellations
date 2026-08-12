export type LayerId =
  | "land"
  | "bathymetry"
  | "routes"
  | "day-night"
  | "chokepoints"
  | "winds"
  | "waves"
  | "currents"
  | "load-state"
  | "port-congestion"
  | "ais-gaps"
  | "sea-ice"
  | "dark-vessels"
  | "canal-restrictions"
  | "piracy"
  | "commodity-prices"
  | "freight-rates";

export type DataLayer = {
  id: LayerId;
  label: string;
  source: string;
  status: "active" | "available" | "credential" | "adapter";
  description: string;
  defaultOn?: boolean;
  locked?: boolean;
};

export const DATA_LAYERS: DataLayer[] = [
  { id: "land", label: "Landmass", source: "Natural Earth", status: "active", description: "Public-domain 110m land geometry.", defaultOn: true, locked: true },
  { id: "bathymetry", label: "Bathymetry", source: "Natural Earth · SRTM+", status: "active", description: "Real nested depth contours at 200, 1,000, 3,000 and 5,000 metres.", defaultOn: true },
  { id: "routes", label: "Maritime routing", source: "Eurostat marnet", status: "active", description: "Computed sea routes for visualization, never for navigation.", defaultOn: false },
  { id: "day-night", label: "Day / night", source: "Computed", status: "active", description: "UTC solar terminator calculated locally.", defaultOn: true },
  { id: "chokepoints", label: "Chokepoints", source: "Curated geography", status: "active", description: "Six globally important trade passages.", defaultOn: true },
  { id: "winds", label: "Surface wind", source: "NOAA GFS", status: "active", description: "Current 10 m wind samples, refreshed from Open-Meteo.", defaultOn: false },
  { id: "waves", label: "Wave height", source: "NCEP GFS Wave · blended", status: "active", description: "Current significant wave height at ocean samples.", defaultOn: false },
  { id: "currents", label: "Ocean currents", source: "Météo-France SMOC", status: "active", description: "Current velocity and direction, accessed through Open-Meteo.", defaultOn: false },
  { id: "load-state", label: "Load state", source: "AIS draught · derived", status: "active", description: "Laden/ballast only when vessel marks or an explicit mock label exist.", defaultOn: true },
  { id: "port-congestion", label: "Port congestion", source: "AIS nav status · derived", status: "active", description: "Anchor and moored counts near known ports. Seven-day trends require history.", defaultOn: false },
  { id: "ais-gaps", label: "AIS gaps", source: "AIS history · derived", status: "active", description: "Marks vessels silent for over ten minutes without claiming intent.", defaultOn: true },
  { id: "sea-ice", label: "Sea ice", source: "NSIDC Sea Ice Index", status: "active", description: "Daily concentration snapshot, reprojected from NSIDC polar GeoTIFFs." },
  { id: "dark-vessels", label: "SAR detections", source: "Global Fishing Watch", status: "credential", description: "Free account and API token required for Sentinel-1 vessel detections." },
  { id: "canal-restrictions", label: "Canal advisories", source: "Panama Canal Authority", status: "active", description: "Latest official draft, outage, navigation, booking and operations advisories." },
  { id: "piracy", label: "Piracy incidents", source: "IMB PRC", status: "active", description: "Current-year reported piracy and armed-robbery incidents from the public IMB map." },
  { id: "commodity-prices", label: "Commodity benchmarks", source: "World Bank Pink Sheet", status: "active", description: "Monthly public benchmarks for cocoa, coffee, wheat and copper; not live futures." },
  { id: "freight-rates", label: "Freight rates", source: "Public index releases", status: "adapter", description: "A normalized free delayed source is not yet selected." },
];

export function defaultLayerSet() {
  return new Set<LayerId>(DATA_LAYERS.filter((layer) => layer.defaultOn).map((layer) => layer.id));
}
