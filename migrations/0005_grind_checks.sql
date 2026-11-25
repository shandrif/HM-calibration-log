-- Grind (KRUVE) & TDS checks: one per bean per shift; re-tests add rows.
CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  sd TEXT NOT NULL,      -- shift day (YYYY-MM-DD the shift started on)
  sh TEXT NOT NULL,      -- 'm' morning 04–16, 'e' evening 16–04
  bean TEXT NOT NULL,
  top INTEGER NOT NULL,  -- tenths of a gram
  mid INTEGER NOT NULL,
  base INTEGER NOT NULL,
  tds INTEGER NOT NULL,  -- hundredths of a percent
  g TEXT NOT NULL,       -- grind result
  r TEXT NOT NULL,       -- tds result
  ok INTEGER NOT NULL,
  by TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX checks_store_day ON checks (store_id, sd);
CREATE INDEX checks_day ON checks (sd);
