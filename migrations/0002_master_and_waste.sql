-- Store details synced weekly from Master_Location_Mapping.xlsx (SharePoint).
ALTER TABLE stores ADD COLUMN syrve_code TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN zone TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN sub_zone TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN area_manager TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN rom TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN location_type TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN drive_thru TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN coord_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN opening_date TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'; -- 'manual' | 'master'
ALTER TABLE stores ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0;

-- One row per day with every store's totals, written once a night.
-- data = {"<storeId>": {"<slot>": [discarded_ml, discard_count, batches, dose1_thrown, dose2_thrown]}}
CREATE TABLE stats_daily (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL
) WITHOUT ROWID;
