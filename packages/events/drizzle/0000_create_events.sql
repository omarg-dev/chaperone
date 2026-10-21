CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`parent_id` text,
	`run_id` text NOT NULL,
	`scenario_id` text,
	`ts` text NOT NULL,
	`lane` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`provenance` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE INDEX `events_run_seq` ON `events` (`run_id`,`seq`);