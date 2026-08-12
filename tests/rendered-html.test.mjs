import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://cargo-constellations.test${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Cargo Constellations experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Cargo Constellations/i);
  assert.match(html, /THE LIVING EDGES OF GLOBAL TRADE/);
  assert.match(html, /STORYBOOK DEMO · SYNTHETIC AIS/);
  assert.match(html, /Interactive globe showing AIS vessel positions/);
  assert.match(html, /WORLD LAYERS/);
  assert.match(html, /Bathymetry/);
  assert.match(html, /NOAA GFS/);
  assert.match(html, /NSIDC Sea Ice Index/);
  assert.match(html, /World Bank Pink Sheet/);
  assert.match(html, /FIELD GUIDE/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders the plain-language field guide", async () => {
  const response = await render("/wiki");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /A world of trade/);
  assert.match(html, /From radio message to point of light/);
  assert.match(html, /What the globe cannot know/);
  assert.match(html, /A small maritime glossary/);
  assert.match(html, /Global Fishing Watch/);
});

test("ships the cartography and social preview assets", async () => {
  await Promise.all([
    access(new URL("../public/land-110m.json", import.meta.url)),
    access(new URL("../public/bathymetry.json", import.meta.url)),
    access(new URL("../public/maritime-lanes.json", import.meta.url)),
    access(new URL("../public/sea-ice.json", import.meta.url)),
    access(new URL("../public/piracy-incidents.json", import.meta.url)),
    access(new URL("../public/canal-advisories.json", import.meta.url)),
    access(new URL("../public/commodity-prices.json", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/og-intelligence.png", import.meta.url)),
    access(new URL("../public/og-dusk-atlas.png", import.meta.url)),
  ]);
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(packageJson, /"ingest": "tsx services\/ais-ingest\.ts"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
