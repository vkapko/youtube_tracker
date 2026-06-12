# #006 — Semantic search

## What to build

A user enters a natural language query and gets back a list of videos ranked by relevance, each showing its best-matching transcript snippet and a timestamp link. Results can be filtered by channel and date range.

## Acceptance criteria

- [x] `POST /api/search` accepts `{ query, channelIds?, fromDate?, toDate?, topK? }` and returns results
- [x] Chroma is queried with the raw query text; Chroma generates the query embedding internally
- [x] Results are deduplicated to one chunk per video (best similarity score wins)
- [x] Each result includes: video title, channel name, published date, thumbnail, matching snippet text, start timestamp, and a YouTube deep-link URL to that timestamp
- [x] If a video has more than one matching chunk above a relevance threshold, the result includes a `additionalMatchCount` field
- [x] Optional lightweight reranking is applied: +0.15 if the query appears in the video title, +0.05 if published within 90 days
- [x] Search page renders a query input, channel multi-select filter, date range filter, and result cards
- [x] Each result card shows thumbnail, title, channel, snippet, timestamp, and a "N more matches" link to the Video Detail page when `additionalMatchCount > 0`
- [x] Clicking a timestamp link opens the YouTube video at the correct time
- [x] Empty results show a clear "no matches found" state

## Blocked by

- #005
