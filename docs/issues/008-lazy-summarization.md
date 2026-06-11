# #008 — Lazy summarization

## What to build

On the Video Detail page, the user can request richer analysis that was not generated at ingestion time: detailed summary, action items, technical terms, and notable quotes. Each type is generated on demand and cached in the `summaries` table. A regenerate button allows refreshing any summary type.

## Acceptance criteria

- [ ] `claude.service` exposes functions for: detailed summary, action items, technical terms, notable quotes — each accepts video metadata and transcript text
- [ ] `GET /api/videos/:youtubeVideoId/summary/:type` returns the cached summary if it exists, or triggers generation and returns it (may be slow on first request — acceptable)
- [ ] Video Detail page shows a section for each lazy summary type with a "Generate" button when not yet available and a "Regenerate" button when cached
- [ ] Generating a summary shows a loading state; the result appears without a page reload
- [ ] Generated summaries are stored in the `summaries` table and returned from cache on subsequent requests
- [ ] Regenerate replaces the existing summary record (not appended)
- [ ] Map-reduce is applied for transcripts that exceed the model context limit (same threshold as eager summarization)
- [ ] The Claude model used is read from `CLAUDE_SUMMARY_MODEL` env var

## Blocked by

- #007
