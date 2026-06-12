# #004 — Ingestion job queue

## What to build

Wrap the ingestion pipeline in a persistent job queue so that multiple videos can be ingested concurrently without overwhelming external APIs, and jobs survive a server restart. The UI shows live job status so the user knows when a video is ready.

## Acceptance criteria

- [x] `p-queue` instance configured with `concurrency: 3` and a 1-second delay between transcript fetch operations
- [x] Every ingestion operation (video or channel sync) creates a row in `ingestion_jobs` with `status: "queued"` before work begins
- [x] Job status transitions (`queued → running → completed / failed`) are written to SQLite at each step
- [x] `error_message` is populated in SQLite when a job fails
- [x] On server startup, all jobs with `status = "running"` are reset to `"queued"` and re-enqueued; all jobs with `status = "queued"` are re-enqueued
- [x] `GET /api/jobs/:id` returns current job status and error message
- [x] Add Video page polls job status and shows a live ingestion progress indicator (queued → fetching metadata → fetching transcript → indexing → summarising → done)
- [x] Failed jobs are displayed with their error message and a retry button
- [x] Integration tests verify the re-hydration query returns all `queued` and `running` rows from SQLite

## Blocked by

- #002
