CREATE TABLE `bot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text,
	`at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bot_events_bot_at_idx` ON `bot_events` (`bot_id`,`at`);--> statement-breakpoint
ALTER TABLE `bots` ADD `restart_count` integer DEFAULT 0 NOT NULL;