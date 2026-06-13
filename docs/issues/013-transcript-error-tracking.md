# #013 - Transcript error tracking and retry observability

## Problem Statement

After issue 012, the Ingestion Pipeline correctly classifies transcript extraction failures into retryable and non-retryable categories at run time. However, that classification is never persisted. Without durable error codes and retryability flags, the dashboard cannot distinguish a transient YouTube failure from a missing Python dependency, the retry route cannot block pointless re-queuing of deterministic failures, and operators have no way to confirm they have corrected the environment before re-running a job.

## Solution

Persist structured error metadata on Ingestion Jobs and expose it through the API and dashboard UI. Non-retryable failures will be blocked from ordinary retry. A force-retry path will allow recovery after an operator corrects the environment or configuration.

## User Stories

1. As an operator, I want failed jobs to expose whether retry is permitted, so that deterministic configuration failures are not repeatedly queued.
2. As an operator, I want to force-retry an explicitly non-retryable job after correcting my environment, so that I can recover without abandoning the job.
3. As a user, I want the dashboard to prevent me from retrying a job that will fail again for the same reason, so that I do not waste time on pointless retries.

## Implementation Decisions

- `ingestion_jobs` will add nullable `error_code` and `retryable` columns. Structured provider failures populate both; unrelated job failures leave them null and preserve existing retry behavior.
- A backward-compatible SQLite migration will add these columns. Existing rows with null values retain current retry behavior without requiring backfill.
- The Ingestion Worker will write `error_code` and `retryable` to the job row when the provider returns a structured failure. The values come from the provider outcome established in issue 012; the worker does not re-classify them.
- A null retryability value means unspecified and remains permitted for backward compatibility and non-provider failures. The retry route allows retry when retryability is null.
- The failed-job retry route will return `409` for `retryable = false` unless the request explicitly sets `force: true`. A forced retry is the recovery path after an operator corrects the environment or configuration.
- Dashboard failed-job responses will expose `errorCode` and `retryable`. The UI will disable the normal retry action when retryability is explicitly false and require a deliberate confirmed force retry.

## Testing Decisions

- Job route and dashboard tests will verify persisted error codes, nullable retryability compatibility, `409` rejection of ordinary non-retryable retries, explicit force retry, and confirmed force-retry presentation.
- Job route tests will verify that null retryability permits retry using existing behavior and that force retry bypasses the `409` guard.
- Web component tests will verify that a failed job with `retryable: false` renders the retry button disabled and displays a non-retryable indicator. Web component tests will verify that the force-retry confirmation requires an explicit user action before the API call is issued, and that cancelling does not call the API. These tests follow the existing `vi.stubGlobal('fetch', ...)` convention.
- Migration tests will verify that the new columns are nullable, that existing rows are unaffected, and that the migration is idempotent.
- The affected API test suite and API typecheck must pass before completion.

## Out of Scope

- Changing transcript extraction behavior, provider selection, protocol design, or error classification (issue 012).
- Automatically switching providers after a non-retryable failure.
- Bulk force-retry or bulk error-code backfill for existing jobs.
- Surfacing error codes or retryability in Search, Chat, or Summary responses.

## Dependencies

- Requires issue 012 (Python transcript provider). The `error_code` values and retryability classification are defined there; this issue only persists and enforces them.
