CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`tier` text NOT NULL,
	`asset_code` text,
	`comment` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devices_asset_code` ON `devices` (`asset_code`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employees_name` ON `employees` (`name`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`checked_out_at` text NOT NULL,
	`returned_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_loans_employee_id` ON `loans` (`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_loans_device_id` ON `loans` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loans_active_device` ON `loans` (`device_id`) WHERE "loans"."returned_at" IS NULL;
--> statement-breakpoint
PRAGMA optimize;
