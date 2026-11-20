-- A legacy asset owner may be attached ONLY by an explicit offline administrator
-- recovery script. Never accept this field from a browser request.
ALTER TABLE paletteiq_stores ADD COLUMN legacy_asset_owner TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS paletteiq_stores_legacy_owner_unique
  ON paletteiq_stores(legacy_asset_owner);
