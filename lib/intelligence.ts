export type SeaIceSnapshot = {
  observedAt: string;
  source: string;
  thresholdPercent: number;
  points: Array<[number, number, number]>;
};

export type PiracyIncident = {
  id: string;
  occurredAt: string | null;
  coords: [number, number];
  category: "attempted" | "boarded" | "fired-upon" | "hijacked" | "suspicious" | "reported";
  narrative: string;
};

export type PiracySnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  incidents: PiracyIncident[];
};

export type CanalAdvisory = {
  id: string;
  subject: string;
  category: "draft" | "outage" | "navigation" | "operations" | "booking";
  url: string;
};

export type CanalSnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  advisories: CanalAdvisory[];
};

export type CommodityPrice = {
  id: string;
  label: string;
  unit: string;
  month: string;
  value: number;
  changePercent: number | null;
  series: Array<{ month: string; value: number }>;
};

export type CommoditySnapshot = {
  observedAt: string;
  source: string;
  sourceUrl: string;
  cadence: "monthly";
  commodities: CommodityPrice[];
};

export type SarDetection = {
  date: string;
  lat: number;
  lon: number;
  detections: number;
};

export type SarSnapshot = {
  observedAt: string;
  dateRange: string;
  source: string;
  filter: "unmatched-with-ais";
  detections: SarDetection[];
};

export type WorldWakeCell = {
  date: string;
  lat: number;
  lon: number;
  hours: number;
  vesselIds: number;
};

export type WorldWakeSnapshot = {
  observedAt: string;
  dateRange: string;
  availableThrough: string;
  delayDays: 4;
  source: string;
  resolution: "one-degree-aggregate";
  filter: "cargo-and-carrier";
  cells: WorldWakeCell[];
};

export type StaticIntelligence = {
  seaIce: SeaIceSnapshot;
  piracy: PiracySnapshot;
  canal: CanalSnapshot;
  commodities: CommoditySnapshot;
};

export async function fetchStaticIntelligence(): Promise<StaticIntelligence> {
  const [seaIce, piracy, canal, commodities] = await Promise.all([
    fetch("/sea-ice.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Sea ice unavailable"))),
    fetch("/piracy-incidents.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Piracy incidents unavailable"))),
    fetch("/canal-advisories.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Canal advisories unavailable"))),
    fetch("/commodity-prices.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Commodity prices unavailable"))),
  ]);
  return { seaIce, piracy, canal, commodities } as StaticIntelligence;
}

function relayHttpBase(websocketUrl: string) {
  const relay = new URL(websocketUrl);
  relay.protocol = relay.protocol === "wss:" ? "https:" : "http:";
  relay.pathname = "";
  relay.search = "";
  relay.hash = "";
  return relay.toString().replace(/\/$/, "");
}

export async function fetchSarDetections(websocketUrl: string): Promise<SarSnapshot> {
  const response = await fetch(`${relayHttpBase(websocketUrl)}/api/sar`);
  if (!response.ok) throw new Error(response.status === 503 ? "GFW token not configured" : "SAR source unavailable");
  return response.json() as Promise<SarSnapshot>;
}

export async function fetchWorldWake(websocketUrl: string): Promise<WorldWakeSnapshot | null> {
  const response = await fetch(`${relayHttpBase(websocketUrl)}/api/world-wake`);
  if (response.status === 202) return null;
  if (!response.ok) throw new Error(response.status === 503 ? "GFW token not configured" : "World wake unavailable");
  return response.json() as Promise<WorldWakeSnapshot>;
}
