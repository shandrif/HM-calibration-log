-- Machine off periods (cleaning / maintenance): one row per off → on, per store and item.
CREATE TABLE downtime (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  day TEXT NOT NULL,       -- store day the machine was turned off
  slot TEXT NOT NULL,      -- item, e.g. hot_drip:ethiopian or espresso_hot
  off_at INTEGER NOT NULL,
  on_at INTEGER,           -- NULL while still off
  by_off TEXT NOT NULL DEFAULT '',
  by_on TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX downtime_store_day ON downtime (store_id, day);
CREATE INDEX downtime_open ON downtime (store_id, on_at);
