# #005 — Chunking + Chroma indexing

## What to build

Once a transcript is available, split it into chunks and index them in Chroma so semantic search becomes possible. Add a CLI reindex command to rebuild the Chroma collection from SQLite without re-fetching any transcripts.

## Acceptance criteria

- [ ] `chunking.service` splits a `TranscriptResult` into chunks of ~500 tokens, cutting at the nearest sentence boundary
- [ ] Each chunk carries the start timestamp of its first segment
- [ ] Chunks overlap by repeating the last 1–2 sentences of the previous chunk
- [ ] Chunks are stored in the `transcript_chunks` table with `chroma_document_id` set to `{videoId}:{chunkIndex}`
- [ ] `chroma.service` indexes chunks by sending raw text to Chroma (Chroma generates embeddings internally via its default model)
- [ ] Each Chroma document includes metadata: `videoId`, `channelId`, `title`, `channelTitle`, `publishedAt`, `startSeconds`, `endSeconds`, `transcriptFilePath`
- [ ] Indexing runs automatically as part of the ingestion pipeline after transcript is saved
- [ ] `npm run reindex` deletes the Chroma collection and re-inserts all chunks for videos with `transcript_status = "available"` from SQLite — no transcripts are re-fetched
- [ ] Unit tests cover chunking with: a short transcript (fewer tokens than one chunk), a long transcript (many chunks), a transcript with no timestamps, and a single sentence exceeding the token limit

## Blocked by

- #003
- #004
