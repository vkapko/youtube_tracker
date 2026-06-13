import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { ManualTranscriptProvider } from '../services/transcript'
import { saveTranscript, readTranscript } from '../services/transcriptFile'
import { TranscriptIndexer } from '../services/transcriptIndexing'
import { ClaudeService } from '../services/claude.service'

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
    const acquisition = await provider.getTranscript(youtubeVideoId)
    if (acquisition.status !== 'ok') {
      throw new Error('Unexpected provider result')
    }
    const result = acquisition.transcript

    const transcriptPath = await saveTranscript({
      channelId: video.youtube_channel_id,
      videoId: youtubeVideoId,
      title: video.title,
      channelName: video.channel_name ?? '',
      publishedAt: video.published_at ?? '',
      result,
    })

    await new TranscriptIndexer(db).indexTranscript({
      videoDbId: video.id,
      videoId: youtubeVideoId,
      channelId: video.youtube_channel_id,
      title: video.title,
      channelTitle: video.channel_name ?? '',
      publishedAt: video.published_at ?? '',
      transcriptFilePath: transcriptPath,
      transcript: result,
    })

    db.prepare(`
      UPDATE videos SET transcript_status = 'available', transcript_file_path = ? WHERE youtube_video_id = ?
    `).run(transcriptPath, youtubeVideoId)

    try {
      const service = new ClaudeService()
      const summaryResult = await service.summarizeVideo(
        { title: video.title, channelTitle: video.channel_name ?? '' },
        result.plainText
      )
      db.prepare(`INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, 'short', ?)`)
        .run(video.id, summaryResult.shortSummary)
      db.prepare(`INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, 'topics', ?)`)
        .run(video.id, JSON.stringify(summaryResult.keyTopics))
      db.prepare(`UPDATE videos SET summary_status = 'available' WHERE id = ?`).run(video.id)
    } catch {
      db.prepare(`UPDATE videos SET summary_status = 'failed' WHERE id = ?`).run(video.id)
    }

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
