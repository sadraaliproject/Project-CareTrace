CREATE TABLE `assertions` (
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`document_id` text NOT NULL,
	`quote` text NOT NULL,
	`date` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`patient_id`, `type`),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assertions_status_check" CHECK("assertions"."status" IN ('active','resolved'))
);
--> statement-breakpoint
CREATE INDEX `assertions_filter` ON `assertions` (`type`,`status`,`patient_id`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created` ON `audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_patient` ON `documents` (`patient_id`,`date`);--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`type` text NOT NULL,
	`patient_id` text,
	`status` text,
	`document_id` text,
	`json` text NOT NULL,
	FOREIGN KEY (`source`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `graph_edges_patient` ON `graph_edges` (`patient_id`);--> statement-breakpoint
CREATE INDEX `graph_edges_source` ON `graph_edges` (`source`,`type`);--> statement-breakpoint
CREATE INDEX `graph_edges_target` ON `graph_edges` (`target`,`type`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`patient_id` text,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_nodes_patient` ON `graph_nodes` (`patient_id`);--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`diabetes` integer NOT NULL,
	`gap_open` integer NOT NULL,
	`days_overdue` integer NOT NULL,
	`a1c` real NOT NULL,
	`refill_gap` integer NOT NULL,
	`priority` integer NOT NULL,
	`structured_barrier_code` integer NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patients_cohort` ON `patients` (`diabetes`,`gap_open`,`age`,`priority`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`engine` text NOT NULL,
	`fingerprint` text,
	`count` integer NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_created` ON `runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`barrier` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`evidence_json` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_one_open` ON `tasks` (`patient_id`,`barrier`) WHERE "tasks"."status" IN ('pending','approved','needs_review');