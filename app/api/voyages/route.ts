import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { voyageFixes, voyages } from "../../../db/schema";

export async function GET(request: Request) {
  try {
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 250);
    const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 250));
    const db = getDb();
    const voyageRows = await db.select().from(voyages).orderBy(desc(voyages.endsAt)).limit(limit);
    if (voyageRows.length === 0) return Response.json({ voyages: [], observedThrough: null });

    const ids = voyageRows.map((voyage) => voyage.id);
    const fixes = await db.select().from(voyageFixes)
      .where(inArray(voyageFixes.voyageId, ids))
      .orderBy(asc(voyageFixes.voyageId), asc(voyageFixes.observedAt));
    const fixesByVoyage = new Map<string, typeof fixes>();
    for (const fix of fixes) {
      const group = fixesByVoyage.get(fix.voyageId) ?? [];
      group.push(fix);
      fixesByVoyage.set(fix.voyageId, group);
    }

    return Response.json({
      observedThrough: voyageRows[0].endsAt.toISOString(),
      voyages: voyageRows.map((voyage) => ({
        ...voyage,
        fixes: (fixesByVoyage.get(voyage.id) ?? []).map((fix) => ({
          observedAt: fix.observedAt.toISOString(),
          lat: fix.latE6 / 1_000_000,
          lon: fix.lonE6 / 1_000_000,
          sog: fix.sogTenths === null ? undefined : fix.sogTenths / 10,
          cog: fix.cogTenths === null ? undefined : fix.cogTenths / 10,
          observation: fix.observation,
        })),
      })),
    }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voyage archive unavailable";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function HEAD(request: Request) {
  const db = getDb();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response(null, { status: 400 });
  const [voyage] = await db.select({ id: voyages.id }).from(voyages).where(eq(voyages.id, id)).limit(1);
  return new Response(null, { status: voyage ? 200 : 404 });
}
