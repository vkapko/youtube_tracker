# PRD: YouTube Channel Content Tracker

## Problem Statement

A researcher following 20–50 AI/tech YouTube channels has no way to search or query across the content of those channels. Watching videos is time-consuming, re-finding a specific explanation or technique requires remembering which video covered it, and there is no way to ask a cross-channel question like "what have these creators said about LangGraph agent orchestration over the past six months?" The knowledge locked in video transcripts is effectively unsearchable.

## Solution

A local-first personal knowledge base that ingests YouTube channels and videos, extracts and indexes their transcripts, and exposes semantic search and Claude-powered chat over the accumulated content. The user adds channels once; the app keeps them up to date automatically. Search returns timestamped snippets linking directly to the relevant moment in the video. Chat answers are grounded in real transcript excerpts with citations.

## User Stories

1. As a researcher, I want to paste a YouTube video URL and have it automatically ingested, so that I can search and chat over its content without manual effort.
2. As a researcher, I want to see the ingestion status of a video in real time, so that I know when it is ready to search.
3. As a researcher, I want to add a YouTube channel by URL or handle, so that all its videos are tracked going forward.
4. As a researcher, I want newly published videos from tracked channels to be ingested automatically without me triggering it, so that my knowledge base stays current.
5. As a researcher, I want channel syncs to run on a 24-hour schedule by default, so that I don't exhaust my YouTube API quota.
6. As a researcher, I want to manually trigger a channel sync at any time, so that I can get new videos immediately when I know they have been published.
7. As a researcher, I want to see a dashboard showing total channels, total indexed videos, recently ingested videos, and failed ingestion jobs, so that I have a clear picture of the health of my knowledge base.
8. As a researcher, I want to search across all indexed transcripts using a natural language query, so that I can find relevant video moments without knowing which video covered the topic.
9. As a researcher, I want search results grouped by video (best matching chunk per video), so that I can quickly scan which videos are relevant rather than reading a flat list of fragments.
10. As a researcher, I want each search result to show the matching snippet and a timestamp link, so that I can jump directly to the relevant moment in the video.
11. As a researcher, I want to filter search results by channel and date range, so that I can scope a query to a specific source or time period.
12. As a researcher, I want to see "N more matches in this video" on a search result, so that I know when a video has multiple relevant moments and can explore them on the Video Detail page.
13. As a researcher, I want to chat with my indexed content using natural language questions, so that I can get synthesized answers that draw on multiple videos.
14. As a researcher, I want chat answers to cite the specific video and timestamp they drew from, so that I can verify the answer and watch the original moment.
15. As a researcher, I want chat responses to stream token by token, so that the interface feels responsive for longer answers.
16. As a researcher, I want the chat scope (which channels are included) to persist across questions in a session, so that I don't have to re-select channels for every message.
17. As a researcher, I want to select "all channels" or a specific subset for a chat session, so that I can focus a conversation on a particular area of my knowledge base.
18. As a researcher, I want to see a short summary and key topics for every indexed video, so that I can quickly understand what a video is about without watching it.
19. As a researcher, I want detailed summaries, action items, technical terms, and notable quotes generated on demand on the Video Detail page, so that I have richer analysis when I need it without paying for it on every video.
20. As a researcher, I want to view the full transcript of a video in a smooth, scrollable viewer, so that I can read the content without performance issues even for long videos.
21. As a researcher, I want to search within a single video's transcript on the Video Detail page, so that I can find a specific moment without leaving the page.
22. As a researcher, I want to watch an embedded YouTube player on the Video Detail page, so that I can watch the video alongside its transcript and summary.
23. As a researcher, I want to see a video's metadata (channel, published date, duration) on the Video Detail page, so that I have full context when reviewing it.
24. As a researcher, I want to manually paste or upload a transcript for a video where automatic extraction fails, so that I can still index videos with no auto-captions.
25. As a researcher, I want failed transcript extractions to be surfaced in the dashboard and on the video page with a retry option, so that I can recover from transient failures.
26. As a researcher, I want videos where YouTube reports no captions to be marked immediately as unavailable (not retried), so that sync jobs don't waste time on known-unresolvable videos.
27. As a researcher, I want ingestion jobs to survive a server restart, so that in-progress channel syncs are not silently lost when I stop the app.
28. As a researcher, I want to reindex the Chroma vector store from SQLite without re-fetching transcripts, so that I can recover from local vector store corruption without losing any data.
29. As a researcher, I want a channel detail view showing indexed video count, failed transcript count, and last sync time, so that I can monitor the health of each tracked channel.
30. As a researcher, I want to trigger a regeneration of a video's summary from the Video Detail page, so that I can refresh it if the model or prompt improves.

## Implementation Decisions

### Modules

**`youtube.service`**
Handles all YouTube Data API interactions: parse video and channel URLs into IDs, fetch video metadata (title, description, duration, hasCaptions, thumbnail, publishedAt), fetch channel metadata, resolve channel handles to IDs, fetch paginated channel uploads list. Single typed interface; all callers go through this service, never the API directly.

**`TranscriptProvider` interface + implementations**
Pluggable interface with two concrete implementations:
- `YouTubeTranscriptProvider` — wraps the `youtube-transcript` npm library. Returns normalized `TranscriptResult` with segments and timestamps.
- `ManualTranscriptProvider` — accepts user-supplied plain text, returns a `TranscriptResult` with `source: "manual"` and no timestamps.
Failure routing: if `hasCaptions = false` from the YouTube API, mark video `unavailable` and skip extraction. If extraction throws unexpectedly, mark `failed` for retry on the next sync.

**`chunking.service`**
Pure function. Accepts a `TranscriptResult` and chunking config. Accumulates segments up to ~500 tokens, cuts at the nearest sentence boundary, carries the start timestamp of the first segment in each chunk, overlaps the last 1–2 sentences into the next chunk. Returns `TranscriptChunk[]`. No I/O.

**`chroma.service`**
Wraps the Chroma SDK. Exposes: index a batch of chunks (passes raw text to the SDK, which embeds locally via its default `Xenova/all-MiniLM-L6-v2` model), query with a text query and optional metadata filters (channelId, date range), delete and recreate the collection (for reindex). All Chroma document IDs use the format `videoId:chunkIndex`.

**`ingestion.service`**
Orchestrates the full ingestion pipeline for a single video: fetch metadata → fetch transcript → save `.txt` → chunk → store chunks in SQLite → index in Chroma → generate eager summary. Owns the `p-queue` instance (concurrency: 3, 1-second delay between transcript fetches). On server startup, re-hydrates the queue from SQLite by re-enqueuing all jobs with `status = queued` and resetting `status = running` jobs back to `queued`.

**`claude.service`**
Wraps the Anthropic SDK. Three responsibilities:
- Eager summarization: generates short summary + key topics at ingestion time.
- Lazy summarization: generates detailed summary, action items, technical terms, notable quotes on demand. Uses map-reduce for transcripts that exceed context limits (chunk → summarize sections → summarize summaries).
- Streaming RAG chat: accepts a question and retrieved transcript chunks, streams the Claude response via SSE, returns structured output (answer, sources with video/timestamp citations, confidence, missing information).

**SQLite + repositories**
`better-sqlite3` with a versioned schema. Typed repositories for: channels, videos, transcript_chunks, summaries, ingestion_jobs. Each repository exposes only the operations its callers need — no raw SQL outside repository files.

**`filesystem.service`**
Read and write transcript `.txt` files under `data/transcripts/{channelId}/{videoId}.txt` and summary `.md` files under `data/summaries/{videoId}.{type}.md`. Returns absolute paths stored in SQLite as the file reference.

**REST API routes**
Express routes:
- `POST /api/videos/ingest` — enqueue a video ingestion job
- `GET /api/videos/:youtubeVideoId` — video detail + status
- `POST /api/channels` — add a channel
- `GET /api/channels` — list tracked channels
- `POST /api/channels/:id/sync` — trigger manual sync
- `POST /api/search` — semantic search with filters
- `POST /api/chat` — streaming RAG chat (SSE response)
- `GET /api/jobs/:id` — job status polling
- `POST /api/reindex` — trigger full Chroma reindex from SQLite

**React frontend**
Pages: Dashboard, AddVideo, Channels, VideoDetail, Search, Chat. VideoDetail uses `@tanstack/virtual` for the transcript viewer. Chat uses an SSE-aware fetch for streaming. Search scope (selected channel IDs) persists in frontend state across the session (not the database).

### Schema
Five tables: `channels`, `videos`, `transcript_chunks`, `summaries`, `ingestion_jobs`. Transcript status values: `pending | available | unavailable | failed`. Summary types: `short | detailed | bullet | topics | action_items`. Job types: `video | channel_sync | reindex`. Job statuses: `queued | running | completed | failed`.

### Channel Sync
Runs automatically on a 24-hour schedule (configurable via `SYNC_INTERVAL_HOURS` env var). Deduplication is ID-based: fetch uploads, skip any `youtube_video_id` already in the `videos` table. This is idempotent and handles backdated or reordered uploads correctly.

### Search Ranking
Chroma returns top-k chunks by vector similarity. Results are deduplicated to one chunk per video (best score wins). Optional lightweight reranking: add 0.15 for title keyword match, 0.05 for videos published within 90 days.

## Testing Decisions

**What makes a good test here:** Tests should verify observable behavior through the module's public interface, not its internal steps. A chunking test should assert on the output chunks given a fixture transcript — not on how many times a helper was called. A repository test should assert on what is readable after a write — not on the SQL that was executed.

**Modules to test:**

- **`chunking.service`** — Unit tests. Pure function with no I/O. Fixture transcripts of varying lengths, speech rates, and edge cases (very short video, no timestamps, single long sentence exceeding token limit). Assert on chunk count, token counts, timestamp carry-through, and overlap correctness.

- **`youtube.service` (URL parsing only)** — Unit tests. The URL-to-ID parsing logic is pure. Cover standard watch URLs, short URLs (`youtu.be`), channel handles (`@name`), `/c/` and `/channel/` formats, and invalid inputs.

- **SQLite repositories** — Integration tests against a real in-memory `better-sqlite3` database (not mocked). Each test creates a fresh DB with the schema applied, runs operations, and asserts on what is readable back. Cover: upsert idempotency on `youtube_video_id`, transcript status transitions, job re-hydration query (all `queued` + `running` rows returned correctly).

## Out of Scope

- Multi-user support or authentication.
- Cloud deployment — this is a local-first tool.
- Support for non-YouTube video platforms.
- Audio download or local speech-to-text transcription (Whisper path).
- Real-time collaborative chat or shared knowledge bases.
- Browser extension or mobile app.
- Automatic translation of non-English transcripts.
- Billing, quota management UI, or YouTube API key rotation.

## Further Notes

- The `TranscriptProvider` interface is the primary risk isolation boundary. If `youtube-transcript` breaks (YouTube internals change), only that one implementation needs updating — the pipeline, chunking, and indexing are unaffected.
- Changing the Chroma embedding model invalidates all existing embeddings. A full reindex (`npm run reindex`) is required after any model change. Document this clearly in the README.
- The 24-hour sync interval keeps YouTube API usage within the 10,000 unit/day free tier for up to 50 channels (channel uploads list costs ~1 unit per page of 50 videos).
- Map-reduce summarization for long transcripts (>~60 minutes) is required to stay within Claude's context window and control cost. The threshold and section size should be configurable.
- ADRs documenting the five most consequential decisions are in `docs/adr/`. Read them before changing transcript acquisition, embedding model, job persistence, sync deduplication, or failure routing.
