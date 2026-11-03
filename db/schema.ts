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
  updatedAt: integer('updated_at').notNull(),
});
