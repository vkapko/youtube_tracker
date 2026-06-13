# #012 - Python transcript provider

## Problem Statement

The Personal Knowledge Base can ingest the wrong transcript for a Video because the current Node transcript extractor selects the first caption track returned by YouTube when no language is specified. That track may be generated, translated, dubbed, or in an unintended language. The npm library also has inconsistent timestamp units across response formats and simplified XML parsing that can merge words.

This makes the resulting Transcript unreliable even when the Video has correct English captions. Incorrect text then propagates through transcript files, Chunks, embeddings, Search, Chat, and Summaries.

## Solution

Use the Python `youtube-transcript-api` library as the primary TranscriptProvider while retaining the Node API as the owner of the Ingestion Pipeline. A dedicated Python adapter will accept a versioned JSON request containing a YouTube video ID and preferred language list, retrieve the selected transcript, and emit timestamped Transcript Segments through a versioned JSON response protocol.

The TypeScript application will invoke the adapter as a subprocess, validate its response, normalize it into the existing TranscriptResult contract, and preserve the current transcript persistence, indexing, status, retry, and manual fallback behavior. Structured error tracking and retry enforcement for non-retryable failures are addressed in issue 013.

## User Stories

1. As a user, I want an ingested Video to use the intended English transcript, so that its content accurately reflects the Video.
2. As a user, I want manually created captions preferred over generated captions when both are available, so that transcript quality is maximized.
3. As a user, I want generated captions used when no manual captions are available, so that automatic ingestion still covers most Videos.
4. As a user, I want preferred transcript languages evaluated in a deterministic order, so that multilingual Videos produce predictable results.
5. As a user, I want Transcript Segment timestamps preserved, so that transcript lines and Search results link to the correct moment in the Video.
6. As a user, I want transcript text preserved without merged words or arbitrary line wrapping, so that Chunks and Summaries contain accurate prose.
7. As a user, I want the absence of a usable transcript under the configured language policy distinguished from a temporary extraction failure, so that the application applies the correct Transcript Status.
8. As a user, I want Videos without usable captions to retain the manual paste and upload fallback, so that they can still enter the Personal Knowledge Base.
9. As a user, I want transient extraction failures eligible for explicit retry, so that temporary YouTube failures can recover without changing Channel Sync deduplication.
10. As a user, I want transcript extraction rate limiting preserved, so that ingestion does not generate excessive YouTube requests.
11. As a user, I want a failed Python process to fail only the affected Ingestion Job, so that other queued Videos continue processing.
12. As a user, I want extraction to time out instead of hanging indefinitely, so that the Ingestion Job queue remains operational.
13. As a user, I want malformed adapter output treated as an extraction failure, so that corrupt data is never saved or indexed.
14. As a developer, I want Python transcript acquisition isolated behind TranscriptProvider, so that the rest of the Ingestion Pipeline remains independent of provider implementation.
15. As a developer, I want a stable structured protocol between Node and Python, so that provider changes do not require changes to persistence, chunking, or indexing.
16. As a developer, I want adapter diagnostics separated from machine-readable output, so that logging cannot corrupt the protocol.
17. As a developer, I want Python dependencies and runtime expectations pinned, so that local development and deployment use reproducible versions.
18. As a developer, I want provider behavior testable without live YouTube requests, so that tests remain offline and deterministic.
19. As a developer, I want extraction errors mapped into explicit categories, so that failure routing can evolve without parsing human-readable messages.
20. As a developer, I want the previous npm provider retained temporarily as an explicit configuration option, so that rollout can be compared and reversed without changing the pipeline.
21. As an operator, I want exactly one configured provider invoked per extraction attempt, so that failures do not silently double YouTube traffic.
22. As an operator, I want errors to identify whether Python is missing, a dependency is missing, YouTube blocked the request, or no transcript exists, so that failures can be diagnosed quickly.
24. As an operator, I want configuration for the Python executable and preferred languages, so that the application works across supported local environments.
25. As an operator, I want secrets excluded from subprocess arguments and logs, so that future proxy configuration does not leak credentials.
26. As a maintainer, I want the Transcript Acquisition Strategy ADR updated, so that the implemented provider decision matches the documented architecture.

## Implementation Decisions

- The existing TranscriptProvider interface remains the application boundary for transcript acquisition.
- A dedicated Python adapter will be a deep module responsible only for transcript selection, retrieval, normalization, and provider error classification.
- The adapter lives at `apps/api/python/transcript_adapter.py`. Python dependencies are pinned in `apps/api/python/requirements.txt`. Tests live in `apps/api/python/tests/`. The `apps/api/python/.venv/` directory is git-ignored.
- The existing multi-purpose transcript CLI will not be invoked directly by the API. Metadata lookup, file naming, summarization, and human-oriented output are outside the adapter.
- Node will spawn one Python process per transcript request. A persistent worker or HTTP sidecar is unnecessary at the current transcript concurrency of one.
- The subprocess will be started without a shell to avoid quoting and command-injection problems.
- Node will write exactly one JSON request document to the child process stdin and then close stdin. The request contains `protocolVersion`, `videoId`, and ordered `preferredLanguages`.
- Command arguments will identify only the adapter entry point. Request data, current configuration values, and any future proxy credentials will not be placed in process arguments.
- The adapter will validate the complete request before contacting YouTube. Unsupported protocol versions or invalid request fields produce a structured `invalid_request` response and exit `1`.
- The stdin request schema is closed: unknown fields are rejected as `invalid_request`. Requests are controlled by Node, so unexpected fields indicate a version mismatch or accidental configuration leakage.
- The protocol will use one JSON document on stdout. Human-readable diagnostics will use stderr only.
- Every response will include `status: 'ok' | 'error'` as the discriminant. Success-only and error-only required fields are mutually exclusive and validated according to that status.
- Node will tolerate unknown response fields while strictly validating all known required fields and invariants. This permits additive protocol v1 evolution without accepting malformed known data.
- The adapter will exit `0` only after emitting a successful response and `1` after emitting a structured error response.
- Exit `2` is reserved for failures where the adapter cannot honor the response protocol, such as invalid CLI invocation before a response can be constructed.
- Node will validate and use structured error JSON even when the process exits `1`. Missing, malformed, oversized, or schema-invalid JSON will be classified by Node as `adapter_protocol_error` rather than inferred from the exit code or stderr.
- Successful responses will include a protocol version, video ID, required selected `languageCode`, required `isGenerated`, optional `languageName`, and ordered segments containing text, start seconds, and duration seconds.
- The TypeScript provider will require the returned `languageCode` to exactly equal one entry in the request's ordered preferred-language list.
- Successful responses must echo the requested `videoId` exactly. A mismatch is `adapter_protocol_error`; Node will discard the response and persist or index nothing from it.
- The TypeScript `TranscriptSegment` contract will gain optional `durationSeconds`. The provider will validate and retain adapter durations in the in-memory `TranscriptResult`.
- `TranscriptResult` will gain optional `languageCode`, `languageName`, and `isGenerated` fields. Extractor results populate them from selected-track metadata; manual results leave them absent.
- Selected-track metadata remains in memory for testability and diagnostics in this slice. It will not be added to Transcript files, database records, or public HTTP responses.
- Existing `.txt` Transcript persistence stores segment start time and text only. Segment duration will not survive file persistence or process restart in this slice, and Chunk construction will continue using existing start-time behavior.
- Segment duration remains part of protocol v1 despite having no durable consumer in this slice. It preserves native provider data for future end-time or transcript-display features without requiring a protocol revision.
- Every extracted segment must have finite `startSeconds >= 0` and finite `durationSeconds >= 0`.
- Segments must be ordered by nondecreasing start time. Equal start times and overlapping durations are valid and will be preserved.
- The TypeScript provider will reject the entire adapter response as `adapter_protocol_error` if any segment violates numeric or ordering invariants.
- The adapter will discard segments whose text is empty after trimming whitespace, while preserving the exact text of every retained segment.
- `youtube-transcript-api` owns provider-level HTML entity decoding. The adapter will not perform additional HTML decoding, whitespace collapsing, Unicode normalization, punctuation rewriting, or line wrapping.
- Retained segment text must not contain `\r` or `\n`. Node will reject a response containing multiline segment text as `adapter_protocol_error` because the existing line-oriented `.txt` format cannot round-trip it without changing segment boundaries.
- If no segments remain, the adapter will return a non-retryable `empty_transcript` error. Both `empty_transcript` and `no_requested_transcript` route to Transcript Status `unavailable` and complete the Ingestion Job.
- Error responses will include a protocol version, stable error code, explicit retryability, and safe diagnostic message.
- The safe diagnostic message must be valid UTF-8, at most 500 characters, and must not contain file system paths, raw exception tracebacks, or URLs. The adapter truncates the message to 497 characters and appends `...` when it would exceed that limit. Exception tracebacks and runtime detail go to stderr only.
- Protocol v1 error codes are `transcripts_disabled`, `no_requested_transcript`, `empty_transcript`, `video_unavailable`, `request_blocked`, `invalid_request`, `dependency_error`, `runtime_error`, and `provider_error`.
- `transcripts_disabled`, `no_requested_transcript`, `empty_transcript`, and `video_unavailable` are non-retryable acquisition outcomes. They set Transcript Status `unavailable` and complete the Ingestion Job.
- `request_blocked` and `provider_error` are retryable failures. They set Transcript Status `failed` and fail the Ingestion Job.
- `invalid_request`, `dependency_error`, and `runtime_error` are non-retryable failures. They set Transcript Status `failed` and fail the Ingestion Job.
- Node-owned errors are `adapter_timeout` (retryable), `adapter_protocol_error` (non-retryable), `adapter_output_too_large` (non-retryable), and `adapter_spawn_error` (non-retryable). All set Transcript Status `failed` and fail the Ingestion Job.
- The adapter's `retryable` value must match the protocol v1 error-code matrix. A mismatch is `adapter_protocol_error`.
- The adapter will not call `sys.exit()` from reusable provider functions. The CLI entry point alone will convert structured outcomes into exit codes.
- Preferred languages will default to `['en', 'en-US', 'en-GB']`. Language priority takes precedence over caption type: for each preferred language in order, the selection policy will prefer a manually created transcript and then a generated transcript before considering the next language.
- Language codes use exact, case-sensitive matching. A preference for `en` does not match `en-US` or `en-GB`; regional variants must be listed explicitly in the desired order.
- Only native transcript tracks whose language code exactly matches an entry in the preferred language list are eligible. The adapter will not expand base languages or translate another language's track to satisfy a preferred language.
- `TRANSCRIPT_PREFERRED_LANGUAGES` is the environment variable for the ordered preferred-language list, formatted as a comma-separated string (e.g. `en,en-US,en-GB`). Omitting the variable uses the default `en,en-US,en-GB`.
- Node will parse preferred-language configuration at application startup, trim surrounding whitespace from each entry, and reject an empty list, empty entries, duplicate entries, or syntactically invalid language codes. It will not silently discard or deduplicate entries.
- Invalid static transcript configuration will prevent application startup with a clear configuration error rather than fail individual Ingestion Jobs.
- The adapter will independently validate every stdin request and return structured `invalid_request` errors for malformed requests, including requests from callers other than the configured Node application.
- Transcript text will not be line-wrapped. Segment boundaries and timestamps will remain intact for transcript files and Chunk construction.
- `TranscriptResult.plainText` will continue to join retained segment text with one literal space. This issue will not introduce punctuation-aware joining or direct concatenation because that would change existing Chunk and Summary inputs beyond the provider replacement.
- The TypeScript provider will validate all adapter output at runtime before constructing TranscriptResult.
- The TypeScript provider will enforce a configurable timeout, maximum stdout size, and maximum stderr size, and will terminate a timed-out child process.
- The initial timeout default is 30 seconds and is configurable. The termination grace period is a fixed 2 seconds.
- Node will cap stdout at a fixed 10 MiB. It will continue draining stderr while retaining at most the first 64 KiB for diagnostics, preventing an unconsumed pipe from blocking the child.
- Stdout exceeding 10 MiB is a non-retryable `adapter_output_too_large` failure. Node will terminate the child and discard the complete stdout payload.
- Stderr exceeding 64 KiB does not fail extraction solely due to size. Node will truncate retained diagnostics while continuing to drain the stream.
- Raw stdout will never be included in application logs, persisted job errors, or thrown error messages.
- Stderr from successful adapter runs will be discarded. When nonempty, Node may emit a debug-level event containing only the byte count, not stderr content.
- On failure, retained stderr is internal diagnostic context only. The persisted job error will use the adapter's safe JSON message; stderr content will not be persisted or returned by public HTTP responses.
- A timeout is classified by Node as retryable `adapter_timeout`, routes to Transcript Status `failed`, and fails only the affected Ingestion Job.
- On timeout, Node will request normal child termination, wait a short grace period, then force termination if the child remains alive. Any partial stdout is discarded and never parsed or persisted.
- The Ingestion Worker will receive its TranscriptProvider through dependency injection instead of constructing a concrete provider internally.
- Existing transcript rate limiting, transcript file persistence, Chunk creation, SQLite storage, Chroma indexing, Summary generation, and manual transcript submission remain in Node.
- Transcript Status routing will treat both metadata with no captions and extraction with no eligible preferred-language track as `unavailable`. These are successful terminal Ingestion Job outcomes and are not retried automatically.
- Unexpected or potentially transient extraction failures route to `failed`; successful extraction routes to `available` after indexing.
- A provider `request_blocked` error routes to `failed`, fails the affected Ingestion Job, and remains eligible for retry. It does not trigger an automatic provider switch.
- Deterministic adapter runtime or dependency failures, including missing `youtube-transcript-api`, route to `failed`. The provider library will be imported lazily so a missing dependency can still produce a structured protocol error. After correcting the environment, an operator may retry the Ingestion Job.
- Retry routing will consume the adapter's structured error code and retryability; it will not parse diagnostic messages.
- Acquisition outcomes that route to `unavailable` are returned as typed provider outcomes rather than thrown failures, allowing the worker to complete the Ingestion Job without saving or indexing a Transcript.
- Channel Sync will continue to enqueue only Videos not already stored. It will not retry failed Transcript acquisition for existing Videos.
- Retrying a failed extraction uses the existing failed-job retry action. Enforcement that prevents retrying non-retryable failures is added in issue 013.
- Provider selection will be configuration-only through `TRANSCRIPT_PROVIDER=python|npm`, defaulting to `python`.
- Exactly one provider will run per extraction attempt. The npm provider will never run automatically after a Python provider error; an operator may switch configuration and retry the Ingestion Job.
- `PYTHON_EXECUTABLE` will identify the supported Python 3.12 executable. When the Python provider is selected, startup validation will reject a missing executable or unsupported Python version before accepting jobs.
- `adapter_spawn_error` is reserved for process creation failing after startup validation has succeeded, such as the executable later being removed or becoming inaccessible.
- Python configuration and dependency validation will be skipped when `TRANSCRIPT_PROVIDER=npm`.
- Python 3.12 will be the supported runtime initially because it is available in the development environment and has broader dependency compatibility than the current Python 3.14 default.
- Python dependencies, including the complete transitive set, will be exactly pinned in a repository-managed requirements lock file. Contributors will use Python 3.12 `venv` plus `pip install -r` with a documented reproducible command; dependency ranges are not permitted in the lock file.
- The reproducible setup commands are: `python3.12 -m venv apps/api/python/.venv && apps/api/python/.venv/bin/pip install -r apps/api/python/requirements.txt` (Unix/macOS) and `py -3.12 -m venv apps\api\python\.venv` then `apps\api\python\.venv\Scripts\pip install -r apps\api\python\requirements.txt` (Windows).
- Python tests run with pytest. The command is `apps/api/python/.venv/bin/pytest apps/api/python/tests/` (Unix/macOS) or `apps\api\python\.venv\Scripts\pytest apps\api\python\tests\` (Windows). Python tests are not part of `npm test` and must be run separately.
- The Transcript Acquisition Strategy ADR will be superseded by a new ADR naming the Python provider as primary and documenting the subprocess boundary.
- The Transcript Failure Status Routing ADR will be amended because `unavailable` now includes videos that have caption tracks but no track eligible under the configured preferred-language policy.

## Testing Decisions

- Tests will assert externally visible behavior and protocol contracts rather than subprocess implementation details or private helper calls.
- Python provider tests will mock `youtube-transcript-api` and verify language priority, manual/generated selection, segment normalization, empty results, and stable error classification.
- Python provider tests will verify whitespace-only segment removal, exact preservation of retained text, and `empty_transcript` when all segments are removed.
- Python provider tests will verify that decoded provider text passes through without additional normalization or double-decoding.
- Protocol tests will verify rejection of multiline segment text.
- Python provider tests will verify exact language-code matching and deterministic ordering across regional variants.
- TypeScript provider tests will verify selected-track metadata normalization and absence on manual results.
- TypeScript provider tests will verify exact response `videoId` correlation and rejection before persistence on mismatch.
- Python CLI contract tests will invoke the adapter with controlled provider fakes and assert that stdout contains valid JSON while diagnostics remain on stderr.
- Python CLI contract tests will send the request through stdin and verify request schema validation, unsupported protocol-version handling, and stdin closure behavior.
- Python CLI contract tests will verify rejection of unknown request fields.
- Python CLI contract tests will assert exit `0` for success, exit `1` for structured adapter/provider errors, and exit `2` only for invocation failures that prevent a protocol response.
- TypeScript provider tests will use a fake process boundary to verify successful normalization, timeout handling, non-zero exits, malformed JSON, oversized output, stderr capture, and unknown error codes.
- Timeout tests will verify retryable `adapter_timeout`, staged termination, partial-output discard, and isolation to the affected Ingestion Job.
- Boundary tests will cover the 30-second default, 2-second termination grace period, 10 MiB stdout cap, and 64 KiB retained stderr cap without requiring wall-clock waits.
- Boundary tests will verify non-retryable oversized stdout, stderr truncation without pipe blockage, and exclusion of raw stdout from diagnostics.
- TypeScript provider tests will verify that validated error JSON from exit `1` controls classification and that exit `2` or unusable stdout becomes `adapter_protocol_error`.
- TypeScript provider tests will reject exit/status mismatches: `status: 'ok'` requires exit `0`, `status: 'error'` requires exit `1`, and exit `2` never carries a trusted protocol response.
- Unknown adapter error codes will become non-retryable `adapter_protocol_error`; Node will not trust retryability attached to an unknown code.
- Protocol tests will verify response discrimination, rejection of mixed or incomplete known fields, and tolerance of additive unknown fields.
- TypeScript provider tests will verify that runtime/dependency failures are marked non-retryable and that retry routing does not inspect diagnostic text.
- Configuration tests will verify startup rejection for empty, duplicate, and invalid preferred-language entries, plus whitespace trimming for valid entries.
- Ingestion tests will inject a fake TranscriptProvider and verify existing status transitions, transcript saving, indexing, and retry behavior without requiring Python or network access.
- Configuration tests will verify conditional Python validation, an exact Python 3.12 version check, and no Python requirement when the npm provider is selected.
- A small opt-in smoke test may exercise the real Python adapter against a known public Video, but it will not run in the deterministic default test suite.
- Regression coverage will include a Video with multiple caption tracks and assert that the configured English track is selected instead of the first returned track.
- Regression coverage will verify that start and duration values remain expressed in seconds and are not divided or multiplied again in TypeScript.
- Regression coverage will verify that adapter duration enters the in-memory `TranscriptResult` but is omitted by the unchanged `.txt` Transcript format.
- Regression coverage will verify rejection of negative or non-finite timestamps, decreasing start times, and acceptance of equal starts and overlaps.
- Regression coverage will verify that adjacent words retain correct spacing and HTML entities are normalized by the provider library.
- Regression coverage will cover normal adjacent phrase segments under the existing single-space `plainText` join; punctuation-only segment spacing remains existing behavior.
- Regression coverage will verify that `request_blocked` produces Transcript Status `failed`, fails only the affected Ingestion Job, and does not invoke a second provider.
- Regression coverage will verify that Channel Sync does not enqueue existing Videos with failed Transcripts.
- Existing transcript service and ingestion route tests provide prior art for normalized TranscriptResult objects, dependency mocks, in-memory SQLite, and job completion assertions.
- The affected API test suite and API typecheck must pass before completion.

## Out of Scope

- Replacing the Node Ingestion Pipeline with a Python service.
- Running a persistent Python worker, message broker consumer, or HTTP sidecar.
- Downloading audio and transcribing it with Whisper or another speech-to-text model.
- Bypassing YouTube restrictions, CAPTCHA challenges, geographic restrictions, or Terms of Service controls.
- Purchasing or configuring residential proxy services as part of the initial implementation.
- Changing transcript file format, Chunk size, embedding model, Search behavior, Chat behavior, or Summary prompts.
- Changing the manual transcript paste and upload experience.
- Reprocessing all existing Transcripts automatically. A separate re-ingestion or migration operation may be defined after rollout.
- Removing the npm transcript provider before the Python provider has been verified in normal local use.
- Automatically chaining the npm provider after a Python provider failure.
- Automatic or unconfirmed retry of failures explicitly classified as non-retryable.
- Persisting error codes and retryable flags to `ingestion_jobs`, enforcing 409 on non-retryable retries, or the force-retry API and UI (issue 013).

## Further Notes

- Neither the current npm provider nor the proposed Python provider uses a YouTube Data API key. Both rely on undocumented YouTube caption endpoints and may require maintenance when YouTube changes behavior.
- The Python provider is preferred because its transcript track selection and structured segment handling are more mature, not because it has privileged API access.
- The current development machine has Python 3.12 and Python 3.14 installed. The default `python` command currently resolves to Python 3.14, so the application must not assume that command selects the supported runtime.
- This issue changes the accepted decision in the Transcript Acquisition Strategy ADR and should include the documentation update in the same implementation slice.
