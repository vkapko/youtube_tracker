# #005 — Chunking + Chroma indexing

## What to build

Once a transcript is available, split it into chunks and index them in Chroma so semantic search becomes possible. Add a CLI reindex command to rebuild the Chroma collection from SQLite without re-fetching any transcripts.

## Acceptance criteria

- [x] `chunking.service` splits a `TranscriptResult` into chunks of ~500 tokens, cutting at the nearest sentence boundary
- [x] Each chunk carries the start timestamp of its first segment
- [x] Chunks overlap by repeating the last 1–2 sentences of the previous chunk
- [x] Chunks are stored in the `transcript_chunks` table with `chroma_document_id` set to `{videoId}:{chunkIndex}`
- [x] `chroma.service` indexes chunks by passing raw text to the Chroma JavaScript SDK, which generates embeddings with its default local model before sending them to Chroma
- [x] Each Chroma document includes metadata: `videoId`, `channelId`, `title`, `channelTitle`, `publishedAt`, `startSeconds`, `endSeconds`, `transcriptFilePath`
- [x] Indexing runs automatically as part of the ingestion pipeline after transcript is saved
- [x] `npm run reindex` deletes the Chroma collection and re-inserts all chunks for videos with `transcript_status = "available"` from SQLite — no transcripts are re-fetched
- [x] Unit tests cover chunking with: a short transcript (fewer tokens than one chunk), a long transcript (many chunks), a transcript with no timestamps, and a single sentence exceeding the token limit

## Blocked by

- #003
- #004
