import type { AisEnvelope, Commodity } from "./ais";

type Route = {
  destination: string;
  commodity: Commodity;
  shipType: number;
  points: Array<[number, number]>;
  count: number;
};

export const PORTS = [
  { name: "Singapore", locode: "SGSIN", coords: [103.82, 1.26] as [number, number] },
  { name: "Rotterdam", locode: "NLRTM", coords: [4.48, 51.92] as [number, number] },
  { name: "Shanghai", locode: "CNSHA", coords: [121.50, 31.23] as [number, number] },
  { name: "Los Angeles", locode: "USLAX", coords: [-118.25, 33.74] as [number, number] },
  { name: "Santos", locode: "BRSSZ", coords: [-46.30, -24.00] as [number, number] },
  { name: "Abidjan", locode: "CIABJ", coords: [-4.02, 5.26] as [number, number] },
  { name: "New Orleans", locode: "USMSY", coords: [-89.96, 29.70] as [number, number] },
  { name: "Qingdao", locode: "CNQDG", coords: [120.30, 36.02] as [number, number] },
  { name: "Valparaíso", locode: "CLVAP", coords: [-71.66, -33.03] as [number, number] },
];

export const CHOKEPOINTS = [
  { name: "Malacca", coords: [101.4, 2.8] as [number, number] },
  { name: "Suez", coords: [32.35, 30.5] as [number, number] },
  { name: "Panama", coords: [-79.6, 9.1] as [number, number] },
  { name: "Bab el-Mandeb", coords: [43.35, 12.6] as [number, number] },
  { name: "Hormuz", coords: [56.4, 26.5] as [number, number] },
  { name: "Gibraltar", coords: [-5.6, 35.95] as [number, number] },
];

const ROUTES: Route[] = [
  {
    destination: "NLRTM", commodity: "container", shipType: 74, count: 22,
    points: [[103.8, 1.3], [96, 5], [80, 7], [58, 12], [44, 12.6], [40, 18], [33, 28], [32.4, 31], [26, 35], [15, 38], [2, 37], [-5.6, 36], [-10, 44], [4.5, 51.9]],
  },
  {
    destination: "SGSIN", commodity: "tanker", shipType: 84, count: 18,
    points: [[55.3, 25.2], [58, 23], [61, 20], [67, 16], [76, 10], [88, 6], [98, 4], [103.8, 1.3]],
  },
  {
    destination: "NLRTM", commodity: "dry-bulk", shipType: 70, count: 14,
    points: [[-46.3, -24], [-37, -27], [-25, -15], [-18, 0], [-15, 18], [-12, 35], [-5.6, 36], [-2, 47], [4.5, 51.9]],
  },
  {
    destination: "NLRTM", commodity: "dry-bulk", shipType: 71, count: 12,
    points: [[-4, 5.3], [-10, 10], [-15, 20], [-14, 32], [-9, 40], [-3, 49], [4.5, 51.9]],
  },
  {
    destination: "NLRTM", commodity: "dry-bulk", shipType: 70, count: 17,
    points: [[-90, 29.7], [-88, 26], [-80, 24], [-65, 31], [-45, 40], [-22, 48], [-6, 50], [4.5, 51.9]],
  },
  {
    destination: "USLAX", commodity: "container", shipType: 75, count: 20,
    points: [[121.5, 31.2], [129, 30], [145, 30], [165, 32], [-175, 34], [-150, 32], [-125, 33], [-118.25, 33.74]],
  },
  {
    destination: "CNQDG", commodity: "dry-bulk", shipType: 70, count: 16,
    points: [[-71.7, -33], [-78, -36], [-95, -35], [-120, -30], [-145, -20], [-170, 0], [165, 15], [140, 28], [120.3, 36]],
  },
];

const PREFIXES = ["Aster", "Calypso", "Meridian", "Horizon", "Pelagic", "Orion", "Zephyr", "Solace"];
const SUFFIXES = ["Star", "Trader", "Passage", "Current", "Mariner", "Venture", "Dawn", "Atlas"];
const FLAG_MIDS = ["352", "477", "563", "636", "538", "232", "255"];

function interpolateLine(points: Array<[number, number]>, progress: number): [number, number] {
  const scaled = progress * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = points[index];
  const b = points[index + 1];
  let dLon = b[0] - a[0];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  let lon = a[0] + dLon * local;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lon, a[1] + (b[1] - a[1]) * local];
}

function bearing(a: [number, number], b: [number, number]) {
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  let dLon = (b[0] - a[0]) * Math.PI / 180;
  if (dLon > Math.PI) dLon -= Math.PI * 2;
  if (dLon < -Math.PI) dLon += Math.PI * 2;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

type MockTrack = {
  route: Route;
  progress: number;
  speed: number;
  mmsi: string;
  name: string;
  imo: string;
  draught: number;
  loadState: "laden" | "ballast";
};

export function createMockAisSource(onMessage: (envelope: AisEnvelope) => void) {
  const tracks: MockTrack[] = [];
  let serial = 0;
  ROUTES.forEach((route, routeIndex) => {
    for (let i = 0; i < route.count; i += 1) {
      const seed = routeIndex * 31 + i * 7 + 11;
      tracks.push({
        route,
        progress: (i / route.count + routeIndex * 0.037) % 1,
        speed: 10 + (seed % 9),
        mmsi: `${FLAG_MIDS[seed % FLAG_MIDS.length]}${String(100000 + seed * 977).slice(-6)}`,
        name: `${PREFIXES[seed % PREFIXES.length]} ${SUFFIXES[(seed * 3) % SUFFIXES.length]}`,
        imo: String(9000000 + seed * 113),
        draught: 7.2 + (seed % 82) / 10,
        loadState: seed % 4 === 0 ? "ballast" : "laden",
      });
    }
  });

  for (const track of tracks) {
    onMessage({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: Number(track.mmsi), Commodity: track.route.commodity, LoadState: track.loadState },
      Message: { ShipStaticData: {
        UserID: Number(track.mmsi), ImoNumber: Number(track.imo), Name: track.name,
        CallSign: `CC${track.mmsi.slice(-4)}`, Type: track.route.shipType,
        Destination: track.route.destination, MaximumStaticDraught: track.draught,
        Dimension: { A: 145, B: 35, C: 13, D: 12 },
      } },
    });
  }

  const emitPositions = () => {
    const now = Date.now();
    for (const track of tracks) {
      const prior = interpolateLine(track.route.points, track.progress);
      track.progress = (track.progress + 0.00048 + track.speed * 0.000002) % 1;
      const position = interpolateLine(track.route.points, track.progress);
      onMessage({
        MessageType: "PositionReport",
        MetaData: { MMSI: Number(track.mmsi), time_utc: new Date(now).toISOString() },
        Message: { PositionReport: {
          UserID: Number(track.mmsi), Latitude: position[1], Longitude: position[0],
          Sog: track.speed, Cog: bearing(prior, position), TrueHeading: Math.round(bearing(prior, position)),
          NavigationalStatus: 0, Timestamp: Math.floor(now / 1000) % 60,
        } },
      });
    }
    serial += 1;
  };

  emitPositions();
  const timer = window.setInterval(emitPositions, 1000);
  return { stop: () => window.clearInterval(timer), count: tracks.length, serial: () => serial, tracks };
}
