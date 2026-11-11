import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  data: text('data').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const studioSettings = sqliteTable('studio_settings', {
  owner: text('owner').primaryKey(),
  preferences: text('preferences').notNull().default('{}'),
  etsyCredential: text('etsy_credential'),
  openaiCredential: text('openai_credential'),
  geminiCredential: text('gemini_credential'),
  upscaleCredential: text('upscale_credential'),
  updatedAt: integer('updated_at').notNull(),
});

export const imageBatches = sqliteTable('image_batches', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  projectId: text('project_id').notNull(),
  openaiBatchId: text('openai_batch_id').notNull(),
  model: text('model').notNull(),
  format: text('format').notNull(),
  status: text('status').notNull(),
  total: integer('total').notNull(),
  completed: integer('completed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  items: text('items').notNull(),
  outputFileId: text('output_file_id'),
  errorFileId: text('error_file_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

