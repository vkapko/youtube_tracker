# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local-first personal knowledge base for YouTube channels: ingest videos/channels, extract transcripts, chunk + index them in Chroma, then search and chat over them with Claude. Single user, npm workspaces monorepo (`apps/api` Express + TypeScript backend, `apps/web` React + Vite frontend).

## Commands

```bash
npm run dev:api          # backend (tsx watch), port 4000 (PORT in .env)
npm run dev:web          # frontend (vite), port 5173
npm run db:migrate       # run SQLite migrations
npm run reindex          # rebuild Chroma collection from SQLite (drops + re-adds)
docker compose up -d     # start Chroma (required for indexing, port 8000)

# Tests (run from apps/api or apps/web, or use --workspace)
npm test --workspace=apps/api                # all API tests (vitest run)
npx vitest run tests/chunking.test.ts        # single test file (cwd apps/api)
npx vitest run -t "splits a long transcript" # single test by name
npm run typecheck --workspace=apps/api       # tsc --noEmit
```

There is no lint setup. Vitest `globals: true` is enabled, but test files import `describe/it/expect` explicitly anyway.

## Architecture

Full pipeline for one video: **metadata → transcript → save .txt → chunk → SQLite chunks → Chroma index → summary** (the "Ingestion Pipeline"). Everything runs as background jobs.

- **Job queue** (`apps/api/src/services/jobQueue.ts`): jobs persisted in the `ingestion_jobs` SQLite table, executed in-process via p-queue (concurrency 3). Worker functions are registered by job type (`ingest_video`, `channel_sync`) in `src/index.ts`. On server start, `rehydrate()` re-queues any `queued`/`running` jobs. Workers report progress via `setStage()`. The queue is a mutable module singleton swapped with `setJobQueue()` — tests construct their own `JobQueue` with mocked workers.
- **Ingest worker** (`src/services/ingestWorker.ts`): the per-video pipeline. Upserts channel + video rows (keyed on `youtube_channel_id` / `youtube_video_id` UNIQUE constraints — dedup is ID-based). A module-level p-queue (concurrency 1, ~1s delay) rate-limits YouTube transcript fetches across all concurrent jobs.
- **Transcript acquisition** (`src/services/transcript.ts`): `TranscriptProvider` interface; primary impl wraps the `youtube-transcript` npm library (ToS-gray, can break — keep it isolated behind the interface). Fallback is manual paste/upload via `routes/transcripts.ts`. Transcript text lives on disk (`data/transcripts/*.txt`), not in SQLite; the DB stores `transcript_file_path` and `transcript_status` (`pending` | `available` | `unavailable` | `failed` — `unavailable` means YouTube reports no captions, `failed` means extraction threw and gets one retry on next sync).
- **Indexing** (`src/services/transcriptIndexing.ts` → `chunking.ts` + `chroma.ts`): chunks ~500 tokens, cut at sentence boundaries with 1–2 sentence overlap, carrying start/end timestamps. Chunks are stored in SQLite (`transcript_chunks`, source of truth) AND in Chroma (document id `{videoId}:{chunkIndex}`). Embeddings are computed server-side by Chroma's default model — the backend only sends raw text. `npm run reindex` rebuilds Chroma from SQLite when they drift.
- **Migrations** (`src/db/migrate.ts`): single idempotent `runMigration(db)` — `CREATE TABLE IF NOT EXISTS` plus pragma-guarded `ALTER TABLE`s for older databases. Add schema changes there, guarded the same way. `getDb()` lazily opens the DB and migrates on first access.
- **Services take dependencies via constructor with production defaults** (e.g. `TranscriptIndexer(db, chroma = new ChromaService())`), so tests inject fakes without module mocks where possible.
- **Summarization** (`src/services/claude.service.ts`): `ClaudeService` handles both eager (short summary + key topics at ingest time) and lazy (detailed summary, action items, quotes, technical terms on demand) summarization. Uses `gpt-tokenizer` to count tokens and truncates transcripts that exceed the model's context window. Summaries are stored as `.md` files in `data/summaries/`.
- **Chat** (`src/services/chat.service.ts`): `ChatService.stream()` is an async generator yielding `ChatEvent` (`token` | `done` | `sources` | `error`). The route (`routes/chat.ts`) forwards these over SSE. Retrieves top-K chunks from Chroma, builds a system prompt embedding excerpts with timestamps, then streams Claude's response. Parses `[N]` citation markers to build the `sources` array returned in the `done` event.
- **Search** (`src/services/search.ts` + `routes/search.ts`): semantic search via Chroma with optional `channelIds` / `dateRange` filters. Results are deduplicated to one best chunk per video and enriched with video metadata from SQLite.
- **Channel sync worker** (`src/services/channelSyncWorker.ts`): handles `channel_sync` jobs by fetching recent video IDs via YouTube API, skipping already-ingested and in-flight videos, and enqueuing `ingest_video` jobs for new ones. Updates `channels.last_checked_at` on completion.
- **Frontend routes** (`apps/web`): `/` (Add Video), `/search`, `/chat`, `/channels`, `/channels/:channelId`, `/videos/:youtubeVideoId`. Chat page uses SSE (`EventSource`-style `fetch` + `ReadableStream`) to stream tokens; SearchPage and ChannelDetailPage share filter/pagination patterns.

## Testing conventions

API tests (`apps/api/tests/`) use `vi.mock('../src/db/database')` to return an in-memory better-sqlite3 instance with `runMigration` applied, and mock the network edges (`lib/youtubeApi`, `youtube-transcript`, `services/chroma`). Route tests use supertest against `src/app.ts` (app is exported separately from the listener in `src/index.ts`). Async job completion is awaited with `jobQueue.waitForIdle()`.

Web tests (`apps/web/src/**/*.test.tsx`) use React Testing Library + vitest with `vi.stubGlobal('fetch', ...)` to mock API responses. SSE streams are simulated with a `ReadableStream` helper that enqueues encoded `data:` lines. Run with `npm test --workspace=apps/web`.

## Docs & workflow

- `CONTEXT.md` — domain glossary; use its terms (Chunk, Segment, Ingestion Job, Channel Sync, eager/lazy Summary) in code and discussion.
- `docs/adr/` — Architecture Decision Records; add one when changing a documented decision (transcript provider, embeddings, queue persistence, dedup, failure routing).
- `docs/issues/` + `PROGRESS.md` — work is sliced into numbered issues; update the PROGRESS.md status table when completing one. Issues 001–010 are done; issue 011 (auto-sync + dashboard) is next.
- `.env` is loaded by `dotenv` in `src/index.ts` only — tests and CLIs relying on env vars must handle their absence (code uses `?? default` fallbacks throughout).
