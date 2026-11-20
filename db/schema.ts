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


/** Email/password identities and store-specific workspaces. */
export const paletteAccounts = sqliteTable('paletteiq_accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordSalt: text('password_salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: integer('locked_until').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
export const paletteStores = sqliteTable('paletteiq_stores', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  legacyAssetOwner: text('legacy_asset_owner'),
  createdAt: integer('created_at').notNull(),
});
export const paletteSessions = sqliteTable('paletteiq_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  activeStoreId: text('active_store_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
