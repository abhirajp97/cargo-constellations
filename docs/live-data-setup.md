# Live AIS setup

## 1. Start with the two credential-free public sources

The relay connects automatically to:

- Fintraffic Digitraffic for Finnish waters over MQTT and its latest-position REST snapshot.
- The Norwegian Coastal Administration's open TCP AIS stream at `153.44.253.27:5631` for Norwegian waters, Svalbard, and Jan Mayen protection zones.

The Norwegian stream is regulated by the Norwegian Licence for Open Government Data (NLOD). External presentations must credit Kystverket. No account or API secret is required.

## 2. Optional: create an aisstream.io API key

1. Open [aisstream.io](https://aisstream.io) and sign in using GitHub or another offered identity provider.
2. Open the **API Keys** page from the signed-in console.
3. Create a key and copy it once into a password manager.
4. Locally, copy `.env.example` to `.env` and set `AISSTREAM_API_KEY`.

Do not paste the key into browser code, a public repository, a prompt, or `NEXT_PUBLIC_*`. aisstream explicitly requires web applications to consume its stream on a backend. The subscription—including the key and bounding boxes—must be sent within three seconds of opening the upstream WebSocket.

## 3. Run the relay locally

```bash
npm run ingest
```

The health endpoint is `http://localhost:8787/health`. It reports Fintraffic, Kystverket, and optional AISStream independently. The relay reconnects with backoff, merges overlapping messages by MMSI, samples a rolling 24-hour in-memory trail, sends browser deltas once per second, prunes stale vessels, and pings downstream clients.

## 4. Host the relay continuously

The recommended shape is:

- Keep the visual site on ChatGPT Sites.
- Put the long-running Node relay on a small always-on container service.
- Point `NEXT_PUBLIC_AIS_WEBSOCKET_URL` at the relay's public `wss://` URL.

### Recommended: Render Web Service

This repository includes `Dockerfile` and `render.yaml`.

1. Push this repository to a private GitHub repository you control.
2. In Render, create a **Blueprint** from that repository, or create a Docker **Web Service** manually.
3. Prefer an always-on instance. The free instance can sleep; the site waits through its wake-up window, but a cold start begins a fresh trail history.
4. Add `AISSTREAM_API_KEY` only if you want the optional AISStream coverage.
5. Add `GFW_API_TOKEN` as a secret if you want unmatched Sentinel-1 SAR detections.
6. Keep `AIS_FULL_GLOBE=false` initially.
7. Set `ALLOWED_ORIGINS` to the exact Cargo Constellations site origin. Multiple origins are comma-separated.
8. Deploy and open `https://YOUR-SERVICE.onrender.com/health`.
9. The browser WebSocket URL is `wss://YOUR-SERVICE.onrender.com`.

Render Web Services accept public WebSocket connections and do not impose a fixed WebSocket duration, although deploys and infrastructure events still interrupt connections. The relay already reconnects on both sides.

### Alternatives

- **Fly.io:** one Machine with autostop disabled. A good fit if you are comfortable with a CLI and Docker.
- **Railway:** a continuously running service with a public domain and the same Dockerfile.
- **Vercel:** fine for a frontend or short request handlers, but not the right home for this stateful WebSocket server. Vercel's own guidance points realtime applications to external providers rather than treating Functions as WebSocket servers.

## 5. Connect the site

For local development, set this in `.env`:

```dotenv
NEXT_PUBLIC_AIS_WEBSOCKET_URL=wss://YOUR-RELAY-HOST
```

For the hosted Site, add the same environment value in the Site settings and redeploy an approved version. When the connection succeeds, the amber demonstration banner changes to **LIVE AIS**.

## Operational cautions

- Keep optional AISStream scoped to its two configured bounding boxes. Full-globe commercial traffic can average hundreds of messages per second.
- Do not run multiple relay instances against the same key until fan-out and shared state are designed for it.
- Keep one instance initially. Horizontal scaling requires Redis or another shared store/pub-sub layer.
- Treat a clean upstream close as recoverable.
- Persist history before enabling congestion trends, replay, or dark-vessel analytics.
