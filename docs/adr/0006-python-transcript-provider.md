# ADR 0006 - Python Transcript Provider

## Status
Accepted

## Context
The npm transcript extractor can select an unintended caption track and has unreliable text and timestamp normalization. Transcript acquisition must become deterministic without moving ownership of the Ingestion Pipeline out of Node.

## Decision
Use `youtube-transcript-api` on Python 3.12 as the primary configured `TranscriptProvider`, invoked once per request through a versioned stdin/stdout JSON subprocess protocol. Keep the npm provider as an explicit configuration option during rollout, never as an automatic per-request fallback; manual Transcript input remains available independently.

## Consequences
- Node retains rate limiting, persistence, Chunk creation, indexing, status routing, retries, and manual input.
- The adapter owns native caption-track selection, retrieval, segment normalization, and stable provider error classification.
- The subprocess boundary adds a Python runtime and locked dependencies, but isolates provider-specific behavior from the application pipeline.
- Provider selection and preferred languages are startup configuration; one extraction attempt invokes exactly one provider.
