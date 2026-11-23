-- Current bean batch (lot) number per bean, per store:
-- {"espresso": {"cur": "A123", "recent": ["A122"], "at": 0, "by": "Sara"}, "ethiopian": {...}, "brazilian": {...}}
ALTER TABLE stores ADD COLUMN beans TEXT NOT NULL DEFAULT '{}';

-- Audit trail of batch changes (rare writes: one per bag opened).
CREATE TABLE bean_changes (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  bean TEXT NOT NULL,
  batch TEXT NOT NULL,
  by TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX bean_changes_batch ON bean_changes (batch);

-- One row per day: per store / batch / slot totals, written by the nightly job.
-- data = [[storeId, batch, slot, logs, discardMl, discards, w1, w2, wgTenths, sumD1, sumD2, minD1, maxD1, minD2, maxD2], ...]
CREATE TABLE batch_daily (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL
) WITHOUT ROWID;
