CREATE TABLE `studio_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`etsy_credential` text,
	`openai_credential` text,
	`updated_at` integer NOT NULL
);
