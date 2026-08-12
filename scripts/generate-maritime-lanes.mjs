import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const searoute = require("searoute-js");

const pairs = [
  { from: "Valparaíso", to: "Qingdao", a: [-71.66, -33.03], b: [120.3, 36.02], trade: "dry-bulk" },
  { from: "Santos", to: "Rotterdam", a: [-46.3, -24], b: [4.48, 51.92], trade: "dry-bulk" },
  { from: "Abidjan", to: "Rotterdam", a: [-4.02, 5.26], b: [4.48, 51.92], trade: "dry-bulk" },
  { from: "New Orleans", to: "Rotterdam", a: [-89.96, 29.7], b: [4.48, 51.92], trade: "dry-bulk" },
  { from: "Singapore", to: "Rotterdam", a: [103.82, 1.26], b: [4.48, 51.92], trade: "container" },
  { from: "Shanghai", to: "Los Angeles", a: [121.5, 31.23], b: [-118.25, 33.74], trade: "container" },
  { from: "Hormuz", to: "Singapore", a: [56.4, 26.5], b: [103.82, 1.26], trade: "tanker" },
];

const point = (coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates } });
const features = pairs.map((pair) => {
  const route = searoute(point(pair.a), point(pair.b), "nauticalmiles");
  return {
    ...route,
    properties: {
      ...route.properties,
      from: pair.from,
      to: pair.to,
      trade: pair.trade,
      provenance: "computed from the Eurostat-derived marnet network; visualization only",
    },
  };
});

await writeFile(
  new URL("../public/maritime-lanes.json", import.meta.url),
  `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
);
