# ADR 0005 — Transcript Failure Status Routing

## Status
Accepted

## Context
Transcript extraction fails for many reasons: no captions exist, network error, YouTube changed its API. Treating all failures the same wastes quota retrying known-unresolvable cases.

## Decision
Route failures by cause:
- `hasCaptions = false` from YouTube API → mark `unavailable` immediately, skip extraction entirely, never retry.
- Captions exist but no native track matches the configured preferred-language policy → mark `unavailable`, complete the ingestion job, never retry automatically.
- YouTube blocks the transcript request → mark `failed`, fail the affected ingestion job, and permit explicit retry.
- Deterministic runtime or dependency failure → mark `failed`, fail the affected ingestion job, and require a confirmed force retry after the environment is corrected.
- Unexpected extraction error → mark `failed`; permit explicit retry when the structured provider outcome marks it retryable.

Manual paste is always available for both statuses.

## Consequences
- No quota burned on caption-less videos across repeated syncs.
- Channel sync remains ID-deduplicated and never retries existing videos. Retryable failures recover through the explicit failed-job retry action.
- Structured provider errors carry retryability so routing never depends on parsing diagnostic messages.
- Failed ingestion jobs persist nullable provider `error_code` and `retryable` metadata. Null retryability preserves existing retry behavior for older and unrelated failures; an explicit false value blocks ordinary retry but permits a confirmed force retry after corrective action.
- `unavailable` is permanent until manually overridden or explicitly retried after acquisition policy changes. If YouTube later adds captions, or preferred languages change, the user must manually trigger a retry.
