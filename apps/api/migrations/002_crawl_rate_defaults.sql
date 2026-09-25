-- Public ATS JSON APIs tolerate ~1 request/second; the old defaults (30/min, 1s spacing)
-- made large boards (hundreds of jobs + detail pages) take several minutes per crawl.
ALTER TABLE source_connectors ALTER COLUMN rate_limit_per_minute SET DEFAULT 60;
ALTER TABLE source_connectors ALTER COLUMN crawl_delay_ms SET DEFAULT 500;
UPDATE source_connectors SET rate_limit_per_minute = 60 WHERE rate_limit_per_minute = 30;
UPDATE source_connectors SET crawl_delay_ms = 500 WHERE crawl_delay_ms = 1000;
