-- Number of drip tanks per item for each store: {"hot_drip:brazilian": 2, ...}. Missing items use the default (2).
ALTER TABLE stores ADD COLUMN tanks TEXT NOT NULL DEFAULT '{}';
