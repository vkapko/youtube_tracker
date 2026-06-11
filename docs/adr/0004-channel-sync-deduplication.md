# ADR 0004 — Channel Sync Deduplication by Video ID

## Status
Accepted

## Context
During a channel sync, the app must decide which fetched videos are new. Two approaches: compare against `last_checked_at` timestamp, or check each video ID against the `videos` table.

## Decision
Deduplicate by `youtube_video_id` existence in the `videos` table. If a video ID is present, skip it. If absent, ingest it. Update `last_checked_at` on the channel after each sync completes.

## Consequences
- Syncs are fully idempotent — safe to re-run after failures with no duplicates.
- Handles backdated uploads and reordered feeds correctly; timestamp cutoffs would silently miss these.
- Slightly more SQLite reads per sync (~50 ID lookups per channel), trivial at medium scale.
- The UNIQUE constraint on `youtube_video_id` is the safety net if deduplication logic ever misfires.
