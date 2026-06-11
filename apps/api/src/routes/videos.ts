import { Router, Request, Response } from 'express'
import { parseYouTubeVideoId } from '../lib/youtubeUrl'
import { fetchVideoMetadata } from '../lib/youtubeApi'
import { getDb } from '../db/database'

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

    db.prepare(`
      INSERT INTO videos
        (youtube_video_id, title, description, duration_seconds, published_at, thumbnail_url, has_captions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(youtube_video_id) DO UPDATE SET
        title            = excluded.title,
        description      = excluded.description,
        duration_seconds = excluded.duration_seconds,
        published_at     = excluded.published_at,
        thumbnail_url    = excluded.thumbnail_url,
        has_captions     = excluded.has_captions
    `).run(
      meta.youtubeVideoId,
      meta.title,
      meta.description,
      meta.durationSeconds,
      meta.publishedAt,
      meta.thumbnailUrl,
      meta.hasCaptions ? 1 : 0,
    )

    const job = db
      .prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'queued', ?)`)
      .run(JSON.stringify({ youtubeVideoId: videoId }))

    res.status(202).json({ jobId: Number(job.lastInsertRowid), status: 'queued', youtubeVideoId: videoId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed'
    res.status(502).json({ error: message })
  }
})

router.get('/:youtubeVideoId', (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const db = getDb()

  const video = db.prepare('SELECT * FROM videos WHERE youtube_video_id = ?').get(youtubeVideoId)
  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  res.json(video)
})

export default router
