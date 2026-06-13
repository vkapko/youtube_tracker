# #011 — Automatic channel sync + Dashboard

## What to build

Channel syncs run automatically on a configurable schedule (default 24 hours) so new videos are ingested without user action. A Dashboard gives a live overview of the knowledge base: total channels, total indexed videos, recent ingestions, and failed jobs.

## Acceptance criteria

- [x] On server startup, a scheduler is initialised that syncs all tracked channels on the interval defined by `SYNC_INTERVAL_HOURS` (default 24)
- [x] Each scheduled sync creates an `ingestion_job` of type `channel_sync` and follows the same ID-based deduplication as manual syncs
- [x] `last_checked_at` on the `channels` table is updated after each sync completes (scheduled or manual)
- [x] `GET /api/dashboard` returns: total tracked channels, total indexed videos, videos without transcripts, total failed ingestion jobs, recently ingested videos (last 10), recently failed jobs (last 5)
- [x] Dashboard page displays all the above stats and refreshes automatically every 30 seconds
- [x] Recently ingested videos are shown as cards linking to their Video Detail pages
- [x] Failed jobs are listed with their error message and a retry button
- [x] The scheduler respects server restarts — it starts fresh on each boot (no cron persistence needed; jobs table handles in-progress recovery)

## Blocked by

- #004
- #010
