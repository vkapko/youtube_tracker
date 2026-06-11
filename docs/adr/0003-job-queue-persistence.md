# ADR 0003 — Ingestion Job Persistence Across Restarts

## Status
Accepted

## Context
The in-process `p-queue` loses all queued and in-progress jobs on server restart. At medium scale, channel syncs over 50 channels can run for minutes. Losing progress silently is a poor experience.

## Decision
On server startup, re-hydrate the job queue from SQLite: any job with `status = queued` is re-enqueued; any job with `status = running` is reset to `queued` and re-enqueued. The `ingestion_jobs` table is the authoritative job log.

## Consequences
- Restart-safe ingestion at no meaningful extra complexity — the table already exists in the schema.
- Jobs that were mid-execution are retried from the start (not resumed mid-step). Ingestion steps are idempotent (upsert on `youtube_video_id`), so retrying is safe.
- A crashed job that loops on restart must be manually cancelled via the UI or direct SQLite edit.
