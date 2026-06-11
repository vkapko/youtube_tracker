# ADR 0001 — Transcript Acquisition Strategy

## Status
Accepted

## Context
The official YouTube Data API does not allow downloading captions for arbitrary public videos. At medium scale (1K–5K videos), manual-only transcript input is not viable. Multiple community strategies exist with different reliability, legality, and maintenance profiles.

## Decision
Use `youtube-transcript` (npm) as the primary `TranscriptProvider`. Fall back to manual paste/upload when extraction fails. Other providers (yt-dlp, Whisper) can be added behind the `TranscriptProvider` interface without touching the pipeline.

## Consequences
- Most AI/tech channels have auto-captions, so coverage will be high in practice.
- The library is ToS-gray and can break when YouTube changes internals. The `TranscriptProvider` interface isolates this risk — swap the implementation without touching ingestion logic.
- Videos where extraction fails are marked `failed` and surfaced in the UI for manual input.
