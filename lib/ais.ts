export type PositionFix = {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading?: number;
  navStatus: number;
  receivedAt: number;
  reportedAt?: number;
};

export type Vessel = {
  mmsi: string;
  imo?: string;
  name?: string;
  callSign?: string;
  shipType?: number;
  flag?: string;
  dimensions?: { a: number; b: number; c: number; d: number };
  lastFix?: PositionFix;
  destination?: string;
  draught?: number;
  eta?: string;
  provider?: string;
  loadState?: "laden" | "ballast" | "unknown";
  commodity?: Commodity;
  source: "live" | "mock";
  trail: Array<[lon: number, lat: number, receivedAt: number]>;
  renderedPosition?: [number, number];
};

export type Commodity =
  | "container"
  | "dry-bulk"
  | "tanker"
  | "general"
  | "unknown";

export type AisEnvelope = {
  MessageType: string;
  MetaData?: Record<string, unknown>;
  Message: Record<string, Record<string, unknown>>;
};

export type VesselDelta = Omit<Vessel, "trail" | "renderedPosition">;

const MID_FLAGS: Record<string, string> = {
  "205": "Belgium",
  "211": "Germany",
  "219": "Denmark",
  "232": "United Kingdom",
  "235": "United Kingdom",
  "244": "Netherlands",
  "246": "Netherlands",
  "247": "Italy",
  "248": "Malta",
  "255": "Portugal",
  "257": "Norway",
  "258": "Norway",
  "273": "Russia",
  "316": "Canada",
  "338": "United States",
  "352": "Panama",
  "353": "Panama",
  "354": "Panama",
  "355": "Panama",
  "356": "Panama",
  "357": "Panama",
  "366": "United States",
  "367": "United States",
  "368": "United States",
  "370": "Panama",
  "371": "Panama",
  "372": "Panama",
  "373": "Panama",
  "374": "Panama",
  "412": "China",
  "413": "China",
  "416": "Taiwan",
  "477": "Hong Kong",
  "538": "Marshall Islands",
  "563": "Singapore",
  "564": "Singapore",
  "565": "Singapore",
  "566": "Singapore",
  "636": "Liberia",
};

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TRAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIVE_TRAIL_SAMPLE_MS = 60_000;
const MAX_TRAIL_POINTS = 1_440;

const text = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : undefined;
};

export function flagFromMmsi(mmsi: string) {
  return MID_FLAGS[mmsi.slice(0, 3)] ?? "Unknown flag";
}

export function commodityFromShipType(shipType?: number): Commodity {
  if (!shipType) return "unknown";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType >= 70 && shipType <= 79) return "container";
  if (shipType >= 60 && shipType <= 69) return "general";
  return "unknown";
}

export function mergeAisEnvelope(
  current: Vessel | undefined,
  envelope: AisEnvelope,
  receivedAt = Date.now(),
  source: Vessel["source"] = "live",
): Vessel | undefined {
  const metadataMmsi = String(envelope.MetaData?.MMSI ?? "");
  const payload = envelope.Message?.[envelope.MessageType];
  if (!payload) return current;
  const mmsi = String(payload.UserID ?? payload.MMSI ?? metadataMmsi);
  if (!/^\d{9}$/.test(mmsi)) return current;

  const vessel: Vessel = current
    ? { ...current }
    : { mmsi, flag: flagFromMmsi(mmsi), source, trail: [] };
  vessel.source = source;
  vessel.provider = text(envelope.MetaData?.Provider) ?? vessel.provider;

  if (["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"].includes(envelope.MessageType)) {
    const lat = number(payload.Latitude, NaN);
    const lon = number(payload.Longitude, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return vessel;
    const fix: PositionFix = {
      lat,
      lon,
      sog: Math.max(0, number(payload.Sog ?? payload.SpeedOverGround)),
      cog: ((number(payload.Cog ?? payload.CourseOverGround) % 360) + 360) % 360,
      heading: number(payload.TrueHeading, NaN),
      navStatus: number(payload.NavigationalStatus),
      receivedAt,
      reportedAt: number(payload.Timestamp, NaN),
    };
    if (!Number.isFinite(fix.heading)) delete fix.heading;
    if (!Number.isFinite(fix.reportedAt)) delete fix.reportedAt;

    const trail = vessel.trail.filter((point) => point[2] >= receivedAt - TRAIL_WINDOW_MS);
    const prior = trail.at(-1);
    const sampleInterval = source === "mock" ? 1_000 : LIVE_TRAIL_SAMPLE_MS;
    if (!prior || (receivedAt - prior[2] >= sampleInterval && (prior[0] !== lon || prior[1] !== lat))) {
      trail.push([lon, lat, receivedAt]);
    }
    if (trail.length > MAX_TRAIL_POINTS) trail.splice(0, trail.length - MAX_TRAIL_POINTS);
    vessel.lastFix = fix;
    vessel.trail = trail;
    if (!vessel.renderedPosition) vessel.renderedPosition = [lon, lat];
  }

  if (["ShipStaticData", "StaticDataReport"].includes(envelope.MessageType)) {
    vessel.name = text(payload.Name ?? payload.ShipName) ?? vessel.name;
    vessel.callSign = text(payload.CallSign) ?? vessel.callSign;
    vessel.imo = text(String(payload.ImoNumber ?? payload.IMO ?? "")) ?? vessel.imo;
    vessel.shipType = number(payload.Type ?? payload.ShipType, vessel.shipType);
    vessel.destination = text(payload.Destination) ?? vessel.destination;
    const draughtDm = number(payload.MaximumStaticDraught ?? payload.Draught, NaN);
    if (Number.isFinite(draughtDm) && draughtDm > 0) vessel.draught = draughtDm > 30 ? draughtDm / 10 : draughtDm;
    vessel.commodity = commodityFromShipType(vessel.shipType);
    if (source === "mock" && typeof envelope.MetaData?.Commodity === "string") {
      vessel.commodity = envelope.MetaData.Commodity as Commodity;
    }
    if (source === "mock" && (envelope.MetaData?.LoadState === "laden" || envelope.MetaData?.LoadState === "ballast")) {
      vessel.loadState = envelope.MetaData.LoadState;
    }
    const dim = (payload.Dimension as Record<string, unknown> | undefined) ?? payload;
    const dimensions = {
      a: number(dim.A), b: number(dim.B), c: number(dim.C), d: number(dim.D),
    };
    if (Object.values(dimensions).some(Boolean)) vessel.dimensions = dimensions;
  }

  return vessel;
}

export function destinationPoint(
  origin: [number, number],
  bearingDeg: number,
  distanceNm: number,
): [number, number] {
  const radiusNm = 3440.065;
  const angular = distanceNm / radiusNm;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = origin[1] * Math.PI / 180;
  const lon1 = origin[0] * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

export function deadReckonedPosition(fix: PositionFix, now: number): [number, number] {
  const elapsedSeconds = Math.max(0, Math.min((now - fix.receivedAt) / 1000, 600));
  return destinationPoint([fix.lon, fix.lat], fix.cog, fix.sog * elapsedSeconds / 3600);
}

export function navStatusLabel(status: number) {
  const labels: Record<number, string> = {
    0: "Under way · engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way · sailing",
  };
  return labels[status] ?? "Status unavailable";
}
