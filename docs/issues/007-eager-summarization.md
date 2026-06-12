# #007 — Eager summarization

## What to build

At the end of the ingestion pipeline, generate a short summary and key topics for every video using Claude. Store them in the `summaries` table and display them on the Video Detail page. This is the only Claude call made automatically during ingestion.

## Acceptance criteria

- [x] `claude.service` exposes a function that accepts video metadata and transcript text and returns `{ shortSummary, keyTopics }`
- [x] Summarization runs automatically at the end of the ingestion pipeline, after chunking and indexing
- [x] Results are stored in the `summaries` table with `summary_type = "short"` and `summary_type = "topics"`
- [x] `summary_status` on the `videos` table is updated to `"available"` on success and `"failed"` on error
- [x] Video Detail page displays the short summary and key topics when available
- [x] If summarization fails, Video Detail page shows a retry button that re-triggers summarization for that video
- [x] For transcripts that exceed the model context limit, map-reduce is applied: transcript is split into sections, each section is summarised, then section summaries are combined into the final short summary and topics
- [x] The Claude model used is read from `CLAUDE_SUMMARY_MODEL` env var

## Blocked by

- #003
- #004
