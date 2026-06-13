# #010 — Channel tracking

## What to build

A user adds a YouTube channel by URL or handle. The app resolves it to a channel ID, fetches all existing uploads, and ingests any that are not already in the database. A Channels page lists all tracked channels with their indexing health. A channel detail view shows per-channel stats.

## Acceptance criteria

- [x] `POST /api/channels` accepts a channel URL or handle (`@name`, `/c/name`, `/channel/UCxxx`), resolves it to a `youtube_channel_id`, and stores the channel in SQLite
- [x] On channel add, all existing uploads are fetched and any video whose `youtube_video_id` is not yet in the `videos` table is enqueued for ingestion
- [x] `GET /api/channels` returns all tracked channels with: title, handle, thumbnail, last\_checked\_at, indexed video count, failed transcript count
- [x] `POST /api/channels/:id/sync` manually triggers a sync: fetch uploads, enqueue new videos, update `last_checked_at`
- [x] Channels page lists all tracked channels as cards with the stats above and a "Sync now" button
- [x] Channel detail page shows the channel's indexed videos, failed transcripts, and last sync time
- [x] Adding a channel that is already tracked is handled gracefully (no duplicate, no error)
- [x] Invalid or unresolvable channel URLs show a validation error

## Blocked by

- #002
