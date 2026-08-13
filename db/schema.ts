import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const voyages = sqliteTable("voyages", {
  id: text("id").primaryKey(),
  vesselId: text("vessel_id").notNull(),
  mmsi: text("mmsi"),
  imo: text("imo"),
  name: text("name"),
  vesselType: text("vessel_type"),
  commodity: text("commodity"),
  source: text("source").notNull(),
  sourceVersion: text("source_version"),
  observationDelayDays: integer("observation_delay_days").notNull().default(4),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  originLabel: text("origin_label"),
  destinationLabel: text("destination_label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_voyages_ends_at").on(table.endsAt),
  index("idx_voyages_vessel_id_starts_at").on(table.vesselId, table.startsAt),
]);

export const voyageFixes = sqliteTable("voyage_fixes", {
  voyageId: text("voyage_id").notNull().references(() => voyages.id, { onDelete: "cascade" }),
  observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
  latE6: integer("lat_e6").notNull(),
  lonE6: integer("lon_e6").notNull(),
  sogTenths: integer("sog_tenths"),
  cogTenths: integer("cog_tenths"),
  observation: text("observation", { enum: ["received", "gridded"] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.voyageId, table.observedAt] }),
]);
