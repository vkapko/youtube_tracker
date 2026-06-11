# #003 — Transcript extraction

## What to build

After a video is ingested, attempt to fetch its transcript automatically using the `youtube-transcript` library. If extraction fails because YouTube reports no captions, mark it `unavailable`. If extraction throws unexpectedly, mark it `failed`. In both cases, surface a manual paste option on the Video Detail page. Save successful transcripts as `.txt` files and display them in a virtualized viewer.

## Acceptance criteria

- [ ] `TranscriptProvider` interface is defined with `getTranscript(videoId): Promise<TranscriptResult>`
- [ ] `YouTubeTranscriptProvider` wraps `youtube-transcript`, returns normalized `TranscriptResult` with segments and timestamps
- [ ] `ManualTranscriptProvider` accepts plain text, returns `TranscriptResult` with `source: "manual"` and no timestamps
- [ ] If `hasCaptions = false` from the YouTube API, transcript is marked `unavailable` immediately without attempting extraction
- [ ] If extraction throws unexpectedly, transcript is marked `failed`
- [ ] Successful transcripts are saved to `data/transcripts/{channelId}/{videoId}.txt` with the header format defined in the design (title, channel, video ID, URL, published date, then timestamped segments)
- [ ] `transcript_file_path` is stored in the `videos` table
- [ ] Video Detail page shows transcript status (`available` / `unavailable` / `failed` / `pending`)
- [ ] For `unavailable` and `failed` statuses, the page shows a manual paste form and a file upload option
- [ ] Submitted manual transcript is saved and status updated to `available`
- [ ] Transcript viewer renders the full transcript in a virtualized list (`@tanstack/virtual`) — smooth scrolling for transcripts of any length
- [ ] Each transcript segment links to the YouTube player at the correct timestamp

## Blocked by

- #002
