import { Router, Request, Response } from 'express'
import { parseYouTubeVideoId } from '../lib/youtubeUrl'
import { fetchVideoMetadata } from '../lib/youtubeApi'
import { getDb } from '../db/database'
import { YouTubeTranscriptProvider } from '../services/transcript'
import { saveTranscript } from '../services/transcriptFile'

const router = Router()

router.post('/ingest', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string }

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' })
    return
  }

  const videoId = parseYouTubeVideoId(url.trim())
  if (!videoId) {
    res.status(400).json({ error: 'Invalid or non-YouTube URL' })
    return
  }

  try {
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

    if (!meta.hasCaptions) {
      res.status(202).json({ status: 'no_captions', youtubeVideoId: videoId })
      return
    }

    const existing = db.prepare(
      'SELECT transcript_status FROM videos WHERE youtube_video_id = ?'
    ).get(videoId) as { transcript_status: string }
    if (existing.transcript_status === 'available') {
      res.status(202).json({ status: 'available', youtubeVideoId: videoId })
      return
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
      res.status(202).json({ status: 'available', youtubeVideoId: videoId })
    } catch {
      db.prepare(
        `UPDATE videos SET transcript_status = 'failed' WHERE youtube_video_id = ?`
      ).run(videoId)
      res.status(202).json({ status: 'failed', youtubeVideoId: videoId })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed'
    res.status(502).json({ error: message })
  }
})

router.get('/:youtubeVideoId', (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const db = getDb()

  const video = db.prepare(`
    SELECT v.*, c.name AS channel_name
    FROM videos v
    LEFT JOIN channels c ON c.id = v.channel_id
    WHERE v.youtube_video_id = ?
  `).get(youtubeVideoId)
  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  res.json(video)
})

export default router
