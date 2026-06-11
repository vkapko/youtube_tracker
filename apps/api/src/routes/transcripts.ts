import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { ManualTranscriptProvider } from '../services/transcript'
import { saveTranscript, readTranscript } from '../services/transcriptFile'

const router = Router({ mergeParams: true })

router.post('/:youtubeVideoId/transcript', async (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const { text } = req.body as { text?: string }

  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' })
    return
  }

  const db = getDb()
  const video = db.prepare(`
    SELECT v.*, c.youtube_channel_id, c.name AS channel_name
    FROM videos v
    LEFT JOIN channels c ON c.id = v.channel_id
    WHERE v.youtube_video_id = ?
  `).get(youtubeVideoId) as any

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  try {
    const provider = new ManualTranscriptProvider(text)
    const result = await provider.getTranscript(youtubeVideoId)

    const transcriptPath = await saveTranscript({
      channelId: video.youtube_channel_id,
      videoId: youtubeVideoId,
      title: video.title,
      channelName: video.channel_name ?? '',
      publishedAt: video.published_at ?? '',
      result,
    })

    db.prepare(`
      UPDATE videos SET transcript_status = 'available', transcript_file_path = ? WHERE youtube_video_id = ?
    `).run(transcriptPath, youtubeVideoId)

    res.json({ transcript_status: 'available', transcript_file_path: transcriptPath })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save transcript'
    res.status(500).json({ error: message })
  }
})

router.get('/:youtubeVideoId/transcript', async (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const db = getDb()

  const video = db.prepare(
    `SELECT transcript_status, transcript_file_path FROM videos WHERE youtube_video_id = ?`
  ).get(youtubeVideoId) as any

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  if (video.transcript_status !== 'available' || !video.transcript_file_path) {
    res.status(404).json({ error: 'Transcript not available' })
    return
  }

  try {
    const segments = await readTranscript(video.transcript_file_path)
    res.json({ segments })
  } catch {
    res.status(500).json({ error: 'Failed to read transcript file' })
  }
})

export default router
