# ADR 0005 — Transcript Failure Status Routing

## Status
Accepted

## Context
Transcript extraction fails for many reasons: no captions exist, network error, YouTube changed its API. Treating all failures the same wastes quota retrying known-unresolvable cases.

## Decision
Route failures by cause:
- `hasCaptions = false` from YouTube API → mark `unavailable` immediately, skip extraction entirely, never retry.
- Unexpected extraction error → mark `failed`, retry once on the next channel sync.

Manual paste is always available for both statuses.

## Consequences
- No quota burned on caption-less videos across repeated syncs.
- Transient failures (network blip) recover automatically on the next sync cycle.
- `unavailable` is permanent until manually overridden. If YouTube later adds captions to a video, the user must manually trigger a retry.
