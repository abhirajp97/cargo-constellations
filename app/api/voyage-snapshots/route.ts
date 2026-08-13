import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { voyageSnapshots } from "../../../db/schema";
import { parseVoyageSnapshot } from "../../../lib/voyage-snapshot";

const MAX_SNAPSHOT_BYTES = 750_000;

function noStore(status = 200) {
  return { status, headers: { "cache-control": "no-store" } };
}

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db.select().from(voyageSnapshots)
      .orderBy(desc(voyageSnapshots.updatedAt))
      .limit(1);
    if (!row) return Response.json({ snapshot: null, persistedAt: null }, noStore());

    return Response.json({
      snapshot: parseVoyageSnapshot(JSON.parse(row.payload)),
      persistedAt: row.updatedAt.toISOString(),
    }, noStore());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voyage snapshot unavailable";
    return Response.json({ error: message }, noStore(500));
  }
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    if (request.headers.get("origin") !== requestUrl.origin) {
      return Response.json({ error: "Same-origin request required" }, noStore(403));
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: "Voyage snapshot is too large" }, noStore(413));
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: "Voyage snapshot is too large" }, noStore(413));
    }

    const snapshot = parseVoyageSnapshot(JSON.parse(body));
    if (snapshot.verdict !== "pass") {
      return Response.json({ error: "Only complete multi-corridor snapshots can be persisted" }, noStore(422));
    }

    const payload = JSON.stringify(snapshot);
    const now = new Date();
    const observedAt = new Date(snapshot.observedAt);
    const id = `gfw-multi-corridor:${snapshot.dateRange}`;
    const db = getDb();
    await db.insert(voyageSnapshots).values({
      id,
      dateRange: snapshot.dateRange,
      observedAt,
      source: snapshot.source,
      corridorCount: snapshot.corridors.length,
      voyageCount: snapshot.candidates.length,
      payload,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: voyageSnapshots.id,
      set: {
        observedAt,
        source: snapshot.source,
        corridorCount: snapshot.corridors.length,
        voyageCount: snapshot.candidates.length,
        payload,
        updatedAt: now,
      },
    });

    return Response.json({ persistedAt: now.toISOString() }, noStore(201));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voyage snapshot could not be persisted";
    return Response.json({ error: message }, noStore(400));
  }
}
