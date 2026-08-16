CREATE TABLE `backtests` (
	`id` text PRIMARY KEY NOT NULL,
	`ruleset_id` text NOT NULL,
	`exchange` text NOT NULL,
	`pairs` text NOT NULL,
	`timerange` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`total_trades` integer,
	`profit_ratio` real,
	`profit_factor` real,
	`expectancy` real,
	`max_drawdown` real,
	`win_rate` real,
	`market_change` real,
	`result` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backtests_ruleset_idx` ON `backtests` (`ruleset_id`);--> statement-breakpoint
CREATE INDEX `backtests_status_idx` ON `backtests` (`status`);--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`exchange_account_id` text,
	`mode` text DEFAULT 'paper' NOT NULL,
	`exchange` text NOT NULL,
	`stake_currency` text NOT NULL,
	`stake_amount` real NOT NULL,
	`max_open_trades` integer NOT NULL,
	`pairs` text NOT NULL,
	`paper_wallet` real,
	`status` text DEFAULT 'stopped' NOT NULL,
	`container_id` text,
	`api_port` integer,
	`api_token_enc` blob,
	`last_error` text,
	`last_seen_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exchange_account_id`) REFERENCES `exchange_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bots_live_requires_account" CHECK("bots"."mode" = 'paper' OR "bots"."exchange_account_id" IS NOT NULL),
	CONSTRAINT "bots_stake_positive" CHECK("bots"."stake_amount" > 0),
	CONSTRAINT "bots_max_open_trades_positive" CHECK("bots"."max_open_trades" > 0)
);
--> statement-breakpoint
CREATE INDEX `bots_status_idx` ON `bots` (`status`);--> statement-breakpoint
CREATE INDEX `bots_ruleset_idx` ON `bots` (`ruleset_id`);--> statement-breakpoint
CREATE TABLE `exchange_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`exchange` text NOT NULL,
	`api_key_enc` blob NOT NULL,
	`api_secret_enc` blob NOT NULL,
	`withdrawal_disabled` integer NOT NULL,
	`last_verified_at` integer,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rulesets` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`forked_from_id` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`forked_from_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rulesets_slug_version_idx` ON `rulesets` (`slug`,`version`);--> statement-breakpoint
CREATE INDEX `rulesets_slug_idx` ON `rulesets` (`slug`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`ft_trade_id` integer NOT NULL,
	`pair` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`open_rate` real NOT NULL,
	`close_rate` real,
	`amount` real NOT NULL,
	`stake_amount` real NOT NULL,
	`profit_abs` real,
	`profit_ratio` real,
	`exit_reason` text,
	`enter_tag` text,
	`synced_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_bot_ft_id_idx` ON `trades` (`bot_id`,`ft_trade_id`);--> statement-breakpoint
CREATE INDEX `trades_bot_closed_idx` ON `trades` (`bot_id`,`closed_at`);