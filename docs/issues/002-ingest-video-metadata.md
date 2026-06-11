# #002 — Ingest video by URL (metadata only)

## What to build

A user pastes a YouTube URL into the Add Video page and gets back a Video Detail page showing the video's metadata. No transcript or summary yet — just the full round-trip from URL to stored video record. This establishes the YouTube API integration, the ingestion endpoint, and the Video Detail page shell that later slices will populate.

## Acceptance criteria

- [x] `POST /api/videos/ingest` accepts a YouTube URL, extracts the video ID, fetches metadata from the YouTube Data API, upserts the video into SQLite, and returns `{ jobId, status: "queued" }`
- [x] Standard watch URLs (`youtube.com/watch?v=`), short URLs (`youtu.be/`), and embed URLs are all parsed correctly
- [x] `GET /api/videos/:youtubeVideoId` returns the stored video (title, description, channel, publishedAt, duration, thumbnailUrl, transcript\_status, summary\_status)
- [x] Add Video page accepts a URL, submits it, and navigates to the Video Detail page on success
- [x] Video Detail page displays title, channel name, published date, duration, thumbnail, and an embedded YouTube player
- [x] Duplicate video URLs are handled gracefully (upsert, no error shown to user)
- [x] Invalid or non-YouTube URLs show a validation error on the Add Video page
- [x] Unit tests cover URL parsing for all supported formats and invalid inputs

## Blocked by

- #001
