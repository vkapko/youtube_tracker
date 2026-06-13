import { fetchChannelRecentVideoIds } from '../lib/youtubeApi'
import { getDb } from '../db/database'
import { jobQueue } from './jobQueue'
import type { JobRow } from './jobQueue'

export function createChannelSyncWorker() {
  return async function channelSyncWorker(job: JobRow, setStage: (s: string) => void): Promise<void> {
    const { youtubeChannelId } = JSON.parse(job.payload) as { youtubeChannelId: string }
    const db = getDb()

    setStage('fetching_videos')
    const videos = await fetchChannelRecentVideoIds(youtubeChannelId)

    const existing = new Set(
      (db.prepare('SELECT youtube_video_id FROM videos').all() as Array<{ youtube_video_id: string }>)
        .map(r => r.youtube_video_id)
    )

    const inFlight = new Set(
      (db.prepare(
        `SELECT json_extract(payload, '$.youtubeVideoId') AS vid FROM ingestion_jobs WHERE type = 'ingest_video' AND status IN ('queued', 'running')`
      ).all() as Array<{ vid: string }>).map(r => r.vid)
    )

    let enqueued = 0
    for (const { videoId } of videos) {
      if (existing.has(videoId) || inFlight.has(videoId)) continue
      const jobId = jobQueue.createJob('ingest_video', { youtubeVideoId: videoId })
      jobQueue.enqueue(jobId)
      enqueued++
    }

    db.prepare(
      `UPDATE channels SET last_checked_at = datetime('now') WHERE youtube_channel_id = ?`
    ).run(youtubeChannelId)

    if (enqueued === 0) return
  }
}
