CREATE TABLE IF NOT EXISTS paletteiq_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paletteiq_stores (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paletteiq_stores_account_idx ON paletteiq_stores(account_id);
CREATE TABLE IF NOT EXISTS paletteiq_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  active_store_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paletteiq_sessions_account_idx ON paletteiq_sessions(account_id);
CREATE INDEX IF NOT EXISTS paletteiq_sessions_expiry_idx ON paletteiq_sessions(expires_at);
