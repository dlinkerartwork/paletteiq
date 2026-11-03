CREATE TABLE `image_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`project_id` text NOT NULL,
	`openai_batch_id` text NOT NULL,
	`model` text NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`total` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`items` text NOT NULL,
	`output_file_id` text,
	`error_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
