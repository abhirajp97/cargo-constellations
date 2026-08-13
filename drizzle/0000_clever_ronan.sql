CREATE TABLE `voyage_fixes` (
	`voyage_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`lat_e6` integer NOT NULL,
	`lon_e6` integer NOT NULL,
	`sog_tenths` integer,
	`cog_tenths` integer,
	`observation` text NOT NULL,
	PRIMARY KEY(`voyage_id`, `observed_at`),
	FOREIGN KEY (`voyage_id`) REFERENCES `voyages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `voyages` (
	`id` text PRIMARY KEY NOT NULL,
	`vessel_id` text NOT NULL,
	`mmsi` text,
	`imo` text,
	`name` text,
	`vessel_type` text,
	`commodity` text,
	`source` text NOT NULL,
	`source_version` text,
	`observation_delay_days` integer DEFAULT 4 NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`origin_label` text,
	`destination_label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_voyages_ends_at` ON `voyages` (`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_voyages_vessel_id_starts_at` ON `voyages` (`vessel_id`,`starts_at`);