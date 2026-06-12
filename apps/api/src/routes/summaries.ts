import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { ClaudeService } from '../services/claude.service'
import { readTranscript } from '../services/transcriptFile'

const router = Router()

const VALID_LAZY_TYPES = new Set([
  'detailed_summary',
  'action_items',
  'technical_terms',
  'notable_quotes',
])

const ARRAY_LAZY_TYPES = new Set(['action_items', 'technical_terms', 'notable_quotes'])

type LazySummaryType = 'detailed_summary' | 'action_items' | 'technical_terms' | 'notable_quotes'

async function callLazyGenerator(
  service: ClaudeService,
  type: LazySummaryType,
  meta: { title: string; channelTitle: string },
  transcriptText: string
): Promise<string | string[]> {
  switch (type) {
    case 'detailed_summary': return service.generateDetailedSummary(meta, transcriptText)
    case 'action_items': return service.generateActionItems(meta, transcriptText)
    case 'technical_terms': return service.generateTechnicalTerms(meta, transcriptText)
    case 'notable_quotes': return service.generateNotableQuotes(meta, transcriptText)
  }
}

router.get('/:youtubeVideoId/summary/:type', async (req: Request, res: Response) => {
  const { youtubeVideoId, type } = req.params

  if (!VALID_LAZY_TYPES.has(type)) {
    res.status(400).json({ error: 'Invalid summary type' })
    return
  }

  const db = getDb()
  const video = db
    .prepare(
      `SELECT v.id, v.title, v.transcript_status, v.transcript_file_path, c.name AS channel_name
       FROM videos v LEFT JOIN channels c ON c.id = v.channel_id
       WHERE v.youtube_video_id = ?`
    )
    .get(youtubeVideoId) as {
      id: number; title: string; transcript_status: string; transcript_file_path: string | null; channel_name: string
    } | undefined

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  const cached = db
    .prepare(`SELECT content FROM summaries WHERE video_id = ? AND type = ?`)
    .get(video.id, type) as { content: string } | undefined

  if (cached) {
    const content = ARRAY_LAZY_TYPES.has(type) ? JSON.parse(cached.content) : cached.content
    if (!Array.isArray(content) || content.length > 0) {
      res.json({ type, content })
      return
    }
    // cached empty array: treat as miss and regenerate
  }

  if (req.query.cacheOnly === 'true') {
    res.status(404).end()
    return
  }

  if (video.transcript_status !== 'available' || !video.transcript_file_path) {
    res.status(422).json({ error: 'Transcript not available for summarization' })
    return
  }

  try {
    const segments = await readTranscript(video.transcript_file_path)
    const transcriptText = segments.map(s => s.text).join(' ')
    const service = new ClaudeService()
    const result = await callLazyGenerator(
      service,
      type as LazySummaryType,
      { title: video.title, channelTitle: video.channel_name ?? '' },
      transcriptText
    )
    const contentToStore = ARRAY_LAZY_TYPES.has(type) ? JSON.stringify(result) : (result as string)
    if (!Array.isArray(result) || result.length > 0) {
      db.prepare(`INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`)
        .run(video.id, type, contentToStore)
    }
    res.json({ type, content: result })
  } catch {
    res.status(502).json({ error: 'Generation failed' })
  }
})

router.post('/:youtubeVideoId/summary/:type', async (req: Request, res: Response) => {
  const { youtubeVideoId, type } = req.params

  if (!VALID_LAZY_TYPES.has(type)) {
    res.status(400).json({ error: 'Invalid summary type' })
    return
  }

  const db = getDb()
  const video = db
    .prepare(
      `SELECT v.id, v.title, v.transcript_status, v.transcript_file_path, c.name AS channel_name
       FROM videos v LEFT JOIN channels c ON c.id = v.channel_id
       WHERE v.youtube_video_id = ?`
    )
    .get(youtubeVideoId) as {
      id: number; title: string; transcript_status: string; transcript_file_path: string | null; channel_name: string
    } | undefined

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  if (video.transcript_status !== 'available' || !video.transcript_file_path) {
    res.status(422).json({ error: 'Transcript not available for summarization' })
    return
  }

  try {
    const segments = await readTranscript(video.transcript_file_path)
    const transcriptText = segments.map(s => s.text).join(' ')
    const service = new ClaudeService()
    const result = await callLazyGenerator(
      service,
      type as LazySummaryType,
      { title: video.title, channelTitle: video.channel_name ?? '' },
      transcriptText
    )
    const contentToStore = ARRAY_LAZY_TYPES.has(type) ? JSON.stringify(result) : (result as string)
    if (!Array.isArray(result) || result.length > 0) {
      db.prepare(`INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, ?, ?)`)
        .run(video.id, type, contentToStore)
    }
    res.json({ type, content: result })
  } catch {
    res.status(502).json({ error: 'Generation failed' })
  }
})

router.get('/:youtubeVideoId/summaries', (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const db = getDb()

  const video = db
    .prepare(`SELECT id, summary_status FROM videos WHERE youtube_video_id = ?`)
    .get(youtubeVideoId) as { id: number; summary_status: string } | undefined

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  if (video.summary_status !== 'available') {
    res.json({ status: video.summary_status })
    return
  }

  const short = db
    .prepare(`SELECT content FROM summaries WHERE video_id = ? AND type = 'short'`)
    .get(video.id) as { content: string } | undefined

  const topics = db
    .prepare(`SELECT content FROM summaries WHERE video_id = ? AND type = 'topics'`)
    .get(video.id) as { content: string } | undefined

  res.json({
    status: 'available',
    shortSummary: short?.content ?? '',
    keyTopics: topics ? JSON.parse(topics.content) : [],
  })
})

router.post('/:youtubeVideoId/summaries/retry', async (req: Request, res: Response) => {
  const { youtubeVideoId } = req.params
  const db = getDb()

  const video = db
    .prepare(
      `SELECT v.id, v.title, v.transcript_status, v.transcript_file_path, c.name AS channel_name
       FROM videos v
       LEFT JOIN channels c ON c.id = v.channel_id
       WHERE v.youtube_video_id = ?`
    )
    .get(youtubeVideoId) as {
    id: number
    title: string
    transcript_status: string
    transcript_file_path: string | null
    channel_name: string
  } | undefined

  if (!video) {
    res.status(404).json({ error: 'Video not found' })
    return
  }

  if (video.transcript_status !== 'available' || !video.transcript_file_path) {
    res.status(422).json({ error: 'Transcript not available for summarization' })
    return
  }

  try {
    const segments = await readTranscript(video.transcript_file_path)
    const transcriptText = segments.map(s => s.text).join(' ')

    const service = new ClaudeService()
    const result = await service.summarizeVideo(
      { title: video.title, channelTitle: video.channel_name ?? '' },
      transcriptText
    )
    db.prepare(`INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, 'short', ?)`)
      .run(video.id, result.shortSummary)
    db.prepare(
      `INSERT OR REPLACE INTO summaries (video_id, type, content) VALUES (?, 'topics', ?)`
    ).run(video.id, JSON.stringify(result.keyTopics))
    db.prepare(`UPDATE videos SET summary_status = 'available' WHERE id = ?`).run(video.id)

    res.json({
      status: 'available',
      shortSummary: result.shortSummary,
      keyTopics: result.keyTopics,
    })
  } catch {
    db.prepare(`UPDATE videos SET summary_status = 'failed' WHERE id = ?`).run(video.id)
    res.status(502).json({ error: 'Summarization failed' })
  }
})

export default router
