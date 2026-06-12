import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { jobQueue } from '../services/jobQueue'

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  const channels = getDb().prepare(
    `SELECT id, youtube_channel_id, name, thumbnail_url FROM channels ORDER BY name ASC`
  ).all()
  res.json({ channels })
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
