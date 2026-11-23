-- Stores (100+). PIN is stored as a salted SHA-256 hash with a server-side pepper.
CREATE TABLE stores (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_ver INTEGER NOT NULL DEFAULT 1,
  lat REAL,
  lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 500,
  espresso_mode TEXT NOT NULL DEFAULT 'pair',
  staff TEXT NOT NULL DEFAULT '[]',          -- JSON array of names
  last_doses TEXT NOT NULL DEFAULT '{}',     -- JSON {slot: [d1, d2]}
  active INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One row per store per day holding all batches as a JSON array.
-- Logging = 1 row written. Retention = 1 row deleted per store per day.
-- This keeps database writes far below the free daily limit.
CREATE TABLE days (
  day TEXT NOT NULL,          -- YYYY-MM-DD in store time (Asia/Riyadh)
  store_id INTEGER NOT NULL,
  batches TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, store_id)
) WITHOUT ROWID;

CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX push_subs_store ON push_subs (store_id);
