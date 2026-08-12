import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import * as XLSX from "xlsx";

const root = resolve(import.meta.dirname, "..");
const output = (name) => resolve(root, "public", name);
const json = (value) => `${JSON.stringify(value)}\n`;

proj4.defs("EPSG:3411", "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:3412", "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +datum=WGS84 +units=m +no_defs");

const monthDirectory = new Intl.DateTimeFormat("en-US", { month: "2-digit" });
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function dateParts(date) {
  const year = date.getUTCFullYear();
  const month = monthDirectory.format(date);
  const day = String(date.getUTCDate()).padStart(2, "0");
  return { year, month, day, compact: `${year}${month}${day}`, iso: `${year}-${month}-${day}` };
}

async function latestSeaIceDate() {
  for (let offset = 1; offset <= 8; offset += 1) {
    const candidate = new Date(Date.now() - offset * 86_400_000);
    const { year, month, compact } = dateParts(candidate);
    const directory = `${month}_${monthShort.format(candidate)}`;
    const north = `https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/geotiff/${year}/${directory}/N_${compact}_concentration_v4.0.tif`;
    const south = `https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/geotiff/${year}/${directory}/S_${compact}_concentration_v4.0.tif`;
    const checks = await Promise.all([north, south].map((url) => fetch(url, { method: "HEAD" })));
    if (checks.every((response) => response.ok)) return { candidate, north, south };
  }
  throw new Error("No recent NSIDC daily sea-ice pair was available");
}

async function seaIcePoints(url, hemisphere) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NSIDC request failed: ${response.status}`);
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const [raster] = await image.readRasters();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const projection = hemisphere === "north" ? "EPSG:3411" : "EPSG:3412";
  const points = [];

  // The source grid is 25 km. Sampling every fourth cell keeps the globe light
  // while retaining the true extent and concentration pattern.
  for (let row = 0; row < height; row += 4) {
    for (let column = 0; column < width; column += 4) {
      const raw = Number(raster[row * width + column]);
      if (raw < 150 || raw > 1000) continue;
      const x = minX + ((column + 0.5) / width) * (maxX - minX);
      const y = maxY - ((row + 0.5) / height) * (maxY - minY);
      const [lon, lat] = proj4(projection, "EPSG:4326", [x, y]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      points.push([Number(lon.toFixed(3)), Number(lat.toFixed(3)), Math.round(raw / 10)]);
    }
  }
  return points;
}

async function buildSeaIce() {
  const latest = await latestSeaIceDate();
  const [north, south] = await Promise.all([
    seaIcePoints(latest.north, "north"),
    seaIcePoints(latest.south, "south"),
  ]);
  const snapshot = {
    observedAt: dateParts(latest.candidate).iso,
    source: "NSIDC Sea Ice Index v4",
    thresholdPercent: 15,
    points: [...north, ...south],
  };
  await writeFile(output("sea-ice.json"), json(snapshot));
  return snapshot.points.length;
}

async function buildPiracy() {
  const response = await fetch("https://icc-ccs.org/wp-json/wpgmza/v1/markers?map_id=23");
  if (!response.ok) throw new Error(`IMB map request failed: ${response.status}`);
  const markers = await response.json();
  const categories = { "1": "attempted", "2": "boarded", "3": "fired-upon", "4": "hijacked", "5": "suspicious" };
  const incidents = markers
    .filter((marker) => marker.map_id === "23")
    .map((marker) => {
      const fields = Object.fromEntries((marker.custom_field_data ?? []).map((field) => [field.name, field.value]));
      return {
        id: fields["Incident Number"] || marker.title,
        occurredAt: fields["Date of Incident"] || null,
        coords: [Number(marker.lng), Number(marker.lat)],
        category: categories[marker.categories?.[0]] ?? "reported",
        narrative: String(fields["Sitrep:"] ?? "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((incident) => incident.id && incident.coords.every(Number.isFinite))
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const snapshot = {
    observedAt: new Date().toISOString(),
    source: "IMB Piracy Reporting Centre",
    sourceUrl: "https://icc-ccs.org/map/",
    incidents,
  };
  await writeFile(output("piracy-incidents.json"), json(snapshot));
  return incidents.length;
}

async function buildCanalAdvisories() {
  const sourceUrl = "https://pancanal.com/en/maritime-services/advisory-to-shipping/";
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Panama Canal request failed: ${response.status}`);
  const $ = cheerio.load(await response.text());
  const seen = new Set();
  const advisories = [];
  $("a").each((_, anchor) => {
    const text = $(anchor).text().replace(/\s+/g, " ").trim();
    const href = $(anchor).attr("href");
    const match = text.match(/^(A-\d+-20\d{2})(.*)$/);
    if (!match || !href || seen.has(match[1])) return;
    seen.add(match[1]);
    const subject = match[2].trim();
    const lower = subject.toLowerCase();
    const category = lower.includes("draft") ? "draft"
      : lower.includes("outage") || lower.includes("maintenance") ? "outage"
        : lower.includes("speed restriction") ? "navigation"
          : lower.includes("operations summary") ? "operations"
            : "booking";
    advisories.push({ id: match[1], subject, category, url: href });
  });
  const snapshot = {
    observedAt: new Date().toISOString(),
    source: "Panama Canal Authority",
    sourceUrl,
    advisories: advisories.slice(0, 12),
  };
  await writeFile(output("canal-advisories.json"), json(snapshot));
  return snapshot.advisories.length;
}

async function buildCommodityPrices() {
  const sourceUrl = "https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/related/CMO-Historical-Data-Monthly.xlsx";
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`World Bank request failed: ${response.status}`);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Monthly Prices"], { header: 1, raw: true });
  const labels = rows[4];
  const units = rows[5];
  const wanted = ["Cocoa", "Coffee, Arabica", "Wheat, US SRW", "Copper"];
  const indices = wanted.map((label) => labels.indexOf(label));
  const observations = rows
    .slice(6)
    .filter((row) => /^\d{4}M\d{2}$/.test(String(row[0])))
    .map((row) => ({
      month: String(row[0]).replace("M", "-"),
      values: indices.map((index) => Number(row[index])),
    }))
    .filter((row) => row.values.every(Number.isFinite));
  const recent = observations.slice(-13);
  const commodities = wanted.map((label, itemIndex) => {
    const series = recent.map((row) => ({ month: row.month, value: Number(row.values[itemIndex].toFixed(3)) }));
    const current = series.at(-1);
    const previous = series.at(-2);
    return {
      id: label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/(^-|-$)/g, ""),
      label,
      unit: String(units[indices[itemIndex]] ?? "USD"),
      month: current.month,
      value: current.value,
      changePercent: previous ? Number((((current.value - previous.value) / previous.value) * 100).toFixed(1)) : null,
      series,
    };
  });
  const snapshot = {
    observedAt: commodities[0]?.month,
    source: "World Bank Pink Sheet",
    sourceUrl,
    cadence: "monthly",
    commodities,
  };
  await writeFile(output("commodity-prices.json"), json(snapshot));
  return commodities.length;
}

const results = await Promise.all([
  buildSeaIce(),
  buildPiracy(),
  buildCanalAdvisories(),
  buildCommodityPrices(),
]);

console.log(`Generated intelligence data · sea ice ${results[0]} samples · piracy ${results[1]} incidents · canal ${results[2]} advisories · commodities ${results[3]}`);
