import { getDb } from '../db/database'
import type { JobQueue } from './jobQueue'

const DEFAULT_SYNC_INTERVAL_HOURS = 24

function syncIntervalHours(): number {
  const configured = Number(process.env.SYNC_INTERVAL_HOURS ?? DEFAULT_SYNC_INTERVAL_HOURS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SYNC_INTERVAL_HOURS
}

export function startChannelSyncScheduler(queue: JobQueue): () => void {
  const interval = setInterval(() => {
    const channels = getDb().prepare(
      'SELECT youtube_channel_id FROM channels ORDER BY id',
    ).all() as Array<{ youtube_channel_id: string }>

    for (const channel of channels) {
      const jobId = queue.createJob('channel_sync', {
        youtubeChannelId: channel.youtube_channel_id,
      })
      queue.enqueue(jobId)
    }
  }, syncIntervalHours() * 60 * 60 * 1000)

  interval.unref()
  return () => clearInterval(interval)
}
