import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { jobQueue } from '../services/jobQueue'
import { ChannelNotFoundError, resolveChannel } from '../lib/youtubeApi'
import { parseYouTubeChannelInput } from '../lib/youtubeUrl'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' })
    return
  }

  const parsed = parseYouTubeChannelInput(url.trim())
  if (!parsed) {
    res.status(400).json({ error: 'Invalid channel URL or handle' })
    return
  }

  let channel: { youtubeChannelId: string; title: string; handle: string | null; thumbnailUrl: string }
  try {
    channel = await resolveChannel(parsed)
  } catch (err) {
    if (err instanceof ChannelNotFoundError) {
      res.status(404).json({ error: err.message })
      return
    }
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to resolve channel' })
    return
  }

  const db = getDb()
  db.prepare(`
    INSERT INTO channels (youtube_channel_id, name, handle, thumbnail_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(youtube_channel_id) DO UPDATE SET
      name = excluded.name,
      handle = excluded.handle,
      thumbnail_url = excluded.thumbnail_url
  `).run(channel.youtubeChannelId, channel.title, channel.handle, channel.thumbnailUrl)

  const row = db.prepare('SELECT id FROM channels WHERE youtube_channel_id = ?').get(channel.youtubeChannelId) as { id: number }

  const jobId = jobQueue.createJob('channel_sync', { youtubeChannelId: channel.youtubeChannelId })
  jobQueue.enqueue(jobId)

  res.status(202).json({ channelId: row.id, youtubeChannelId: channel.youtubeChannelId, jobId })
})

router.get('/', (_req: Request, res: Response) => {
  const channels = getDb().prepare(`
    SELECT
      c.id,
      c.youtube_channel_id,
      c.name,
      c.handle,
      c.thumbnail_url,
      c.last_checked_at,
      COUNT(CASE WHEN v.transcript_status = 'available' THEN 1 END) AS indexed_video_count,
      COUNT(CASE WHEN v.transcript_status = 'failed' THEN 1 END) AS failed_transcript_count
    FROM channels c
    LEFT JOIN videos v ON v.channel_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all()
  res.json({ channels })
})

router.get('/:id', (req: Request, res: Response) => {
  const channelId = Number(req.params.id)
  if (!Number.isInteger(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' })
    return
  }

  const db = getDb()
  const channel = db.prepare(
    'SELECT id, youtube_channel_id, name, handle, thumbnail_url, last_checked_at FROM channels WHERE id = ?'
  ).get(channelId) as object | undefined

  if (!channel) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }

  const videos = db.prepare(`
    SELECT youtube_video_id, title, transcript_status, summary_status, published_at, thumbnail_url
    FROM videos
    WHERE channel_id = ?
    ORDER BY published_at DESC
  `).all(channelId)

  res.json({ channel, videos })
})

router.post('/:id/sync', (req: Request, res: Response) => {
  const channelId = Number(req.params.id)
  if (!Number.isInteger(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' })
    return
  }

  const channel = getDb().prepare(
    'SELECT youtube_channel_id FROM channels WHERE id = ?'
  ).get(channelId) as { youtube_channel_id: string } | undefined

  if (!channel) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }

  const jobId = jobQueue.createJob('channel_sync', {
    youtubeChannelId: channel.youtube_channel_id,
  })
  jobQueue.enqueue(jobId)

  res.status(202).json({ jobId, channelId })
})

export default router
