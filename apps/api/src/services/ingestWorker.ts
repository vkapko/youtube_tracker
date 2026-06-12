import PQueue from 'p-queue'
import { fetchVideoMetadata } from '../lib/youtubeApi'
import { getDb } from '../db/database'
import { YouTubeTranscriptProvider } from './transcript'
import type { TranscriptResult } from './transcript'
import { saveTranscript, readTranscript } from './transcriptFile'
import { TranscriptIndexer } from './transcriptIndexing'
import type { ClaudeService } from './claude.service'
import type { JobRow } from './jobQueue'

// Shared across all concurrent ingest jobs — enforces at most one YouTube transcript
// request in flight at a time, with a configurable delay between requests.
const transcriptRateLimiter = new PQueue({ concurrency: 1 })

export function createIngestVideoWorker(
  transcriptFetchDelayMs = 1000,
  claudeService?: Pick<ClaudeService, 'summarizeVideo'>
) {
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

    const videoRow = db.prepare(`
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
      RETURNING id
    `).get(
      meta.youtubeVideoId,
      channelRow.id,
      meta.title,
      meta.description,
      meta.durationSeconds,
      meta.publishedAt,
      meta.thumbnailUrl,
      meta.hasCaptions ? 1 : 0,
      meta.hasCaptions ? 'pending' : 'unavailable',
    ) as { id: number }

    if (!meta.hasCaptions) return

    const existing = db.prepare(
      'SELECT transcript_status, transcript_file_path, summary_status FROM videos WHERE youtube_video_id = ?'
    ).get(videoId) as { transcript_status: string; transcript_file_path: string | null; summary_status: string }

    if (existing.transcript_status === 'available') {
      if (claudeService && existing.summary_status !== 'available' && existing.transcript_file_path) {
        setStage('summarising')
        try {
          const segments = await readTranscript(existing.transcript_file_path)
          const plainText = segments.map(s => s.text).join(' ')
          const summaryResult = await claudeService.summarizeVideo(
            { title: meta.title, channelTitle: meta.channelTitle },
            plainText
          )
          db.prepare(
            `INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`
          ).run(videoRow.id, 'short', summaryResult.shortSummary)
          db.prepare(
            `INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`
          ).run(videoRow.id, 'topics', JSON.stringify(summaryResult.keyTopics))
          db.prepare(
            `UPDATE videos SET summary_status = 'available' WHERE id = ?`
          ).run(videoRow.id)
        } catch {
          db.prepare(
            `UPDATE videos SET summary_status = 'failed' WHERE id = ?`
          ).run(videoRow.id)
        }
      }
      return
    }

    setStage('fetching_transcript')
    let transcriptResult: TranscriptResult | undefined
    let transcriptPath: string | undefined
    await transcriptRateLimiter.add(async () => {
      if (transcriptFetchDelayMs > 0) {
        await new Promise(r => setTimeout(r, transcriptFetchDelayMs))
      }
      try {
        const provider = new YouTubeTranscriptProvider()
        transcriptResult = await provider.getTranscript(videoId)
        transcriptPath = await saveTranscript({
          channelId: meta.channelId,
          videoId,
          title: meta.title,
          channelName: meta.channelTitle,
          publishedAt: meta.publishedAt,
          result: transcriptResult,
        })
      } catch (err) {
        db.prepare(
          `UPDATE videos SET transcript_status = 'failed' WHERE youtube_video_id = ?`
        ).run(videoId)
        throw err
      }
    })

    setStage('indexing')
    if (!transcriptResult || !transcriptPath) {
      throw new Error('Transcript indexing data was not produced')
    }
    try {
      await new TranscriptIndexer(db).indexTranscript({
        videoDbId: videoRow.id,
        videoId,
        channelId: meta.channelId,
        title: meta.title,
        channelTitle: meta.channelTitle,
        publishedAt: meta.publishedAt,
        transcriptFilePath: transcriptPath,
        transcript: transcriptResult,
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
    setStage('summarising')
    if (claudeService) {
      try {
        const summaryResult = await claudeService.summarizeVideo(
          { title: meta.title, channelTitle: meta.channelTitle },
          transcriptResult.plainText
        )
        db.prepare(
          `INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`
        ).run(videoRow.id, 'short', summaryResult.shortSummary)
        db.prepare(
          `INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`
        ).run(videoRow.id, 'topics', JSON.stringify(summaryResult.keyTopics))
        db.prepare(
          `UPDATE videos SET summary_status = 'available' WHERE id = ?`
        ).run(videoRow.id)
      } catch {
        db.prepare(
          `UPDATE videos SET summary_status = 'failed' WHERE id = ?`
        ).run(videoRow.id)
      }
    }
  }
}
