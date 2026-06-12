import { Router, Request, Response } from 'express'
import { parseYouTubeVideoId } from '../lib/youtubeUrl'
import { getDb } from '../db/database'
import { jobQueue } from '../services/jobQueue'

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
    const jobId = jobQueue.createJob('ingest_video', { youtubeVideoId: videoId })
    jobQueue.enqueue(jobId)
    res.status(202).json({ jobId, youtubeVideoId: videoId })
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
