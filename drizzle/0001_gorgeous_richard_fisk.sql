DROP INDEX `idx_loans_active_device`;--> statement-breakpoint
ALTER TABLE `devices` ADD `os_version` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `photo_key` text;--> statement-breakpoint
PRAGMA optimize;
