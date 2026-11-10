CREATE TABLE `model_spend` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`call_id` text NOT NULL,
	`kind` text NOT NULL,
	`ts` text NOT NULL,
	`cost_usd` real NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `model_spend_purpose_ts` ON `model_spend` (`purpose`,`ts`);