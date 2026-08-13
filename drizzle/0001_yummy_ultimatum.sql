CREATE TABLE `voyage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date_range` text NOT NULL,
	`observed_at` integer NOT NULL,
	`source` text NOT NULL,
	`corridor_count` integer NOT NULL,
	`voyage_count` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_voyage_snapshots_updated_at` ON `voyage_snapshots` (`updated_at`);--> statement-breakpoint
PRAGMA optimize;
