import PQueue from 'p-queue'
import { fetchVideoMetadata } from '../lib/youtubeApi'
import { getDb } from '../db/database'
import { YouTubeTranscriptProvider } from './transcript'
import { saveTranscript } from './transcriptFile'
import type { JobRow } from './jobQueue'

// Shared across all concurrent ingest jobs — enforces at most one YouTube transcript
// request in flight at a time, with a configurable delay between requests.
const transcriptRateLimiter = new PQueue({ concurrency: 1 })

export function createIngestVideoWorker(transcriptFetchDelayMs = 1000) {
  return async function ingestVideoWorker(job: JobRow, setStage: (s: string) => void): Promise<void> {
    const { youtubeVideoId: videoId } = JSON.parse(job.payload) as { youtubeVideoId: string }

    setStage('fetching_metadata')
    const meta = await fetchVideoMetadata(videoId)
    const db = getDb()

    const channelRow = db.prepare(`
      INSERT INTO channels (youtube_channel_id, name)
      VALUES (?, ?)
      ON CONFLICT(youtube_channel_id) DO UPDATE SET name = excluded.name
      RETURNING id
    `).get(meta.channelId, meta.channelTitle) as { id: number }

    db.prepare(`
      INSERT INTO videos
        (youtube_video_id, channel_id, title, description, duration_seconds, published_at, thumbnail_url, has_captions, transcript_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(youtube_video_id) DO UPDATE SET
        channel_id        = excluded.channel_id,
        title             = excluded.title,
        description       = excluded.description,
        duration_seconds  = excluded.duration_seconds,
        published_at      = excluded.published_at,
        thumbnail_url     = excluded.thumbnail_url,
        has_captions      = excluded.has_captions,
        transcript_status = CASE WHEN videos.transcript_status = 'available' THEN videos.transcript_status ELSE excluded.transcript_status END
    `).run(
      meta.youtubeVideoId,
      channelRow.id,
      meta.title,
      meta.description,
      meta.durationSeconds,
      meta.publishedAt,
      meta.thumbnailUrl,
      meta.hasCaptions ? 1 : 0,
      meta.hasCaptions ? 'pending' : 'unavailable',
    )

    if (!meta.hasCaptions) return

    const existing = db.prepare(
      'SELECT transcript_status FROM videos WHERE youtube_video_id = ?'
    ).get(videoId) as { transcript_status: string }
    if (existing.transcript_status === 'available') return

    setStage('fetching_transcript')
    await transcriptRateLimiter.add(async () => {
      if (transcriptFetchDelayMs > 0) {
        await new Promise(r => setTimeout(r, transcriptFetchDelayMs))
      }
      try {
        const provider = new YouTubeTranscriptProvider()
        const transcriptResult = await provider.getTranscript(videoId)
        const transcriptPath = await saveTranscript({
          channelId: meta.channelId,
          videoId,
          title: meta.title,
          channelName: meta.channelTitle,
          publishedAt: meta.publishedAt,
          result: transcriptResult,
        })
        db.prepare(
          `UPDATE videos SET transcript_status = 'available', transcript_file_path = ? WHERE youtube_video_id = ?`
        ).run(transcriptPath, videoId)
      } catch (err) {
        db.prepare(
          `UPDATE videos SET transcript_status = 'failed' WHERE youtube_video_id = ?`
        ).run(videoId)
        throw err
      }
    })

    setStage('indexing')
    setStage('summarising')
  }
}
