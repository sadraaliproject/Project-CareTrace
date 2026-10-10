CREATE TABLE `live_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`question` text NOT NULL,
	`mode` text NOT NULL,
	`count` integer NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `live_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_runs_session` ON `live_runs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `live_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_sessions_expiry` ON `live_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `live_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`barrier` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`evidence_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `live_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "live_tasks_status" CHECK("live_tasks"."status" IN ('draft','approved','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_tasks_patient_barrier` ON `live_tasks` (`session_id`,`patient_id`,`barrier`);--> statement-breakpoint
CREATE INDEX `live_tasks_session` ON `live_tasks` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `live_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`model_run` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `live_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_usage_session` ON `live_usage` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `live_usage_global` ON `live_usage` (`created_at`,`model_run`);--> statement-breakpoint
CREATE INDEX `live_usage_expiry` ON `live_usage` (`expires_at`);