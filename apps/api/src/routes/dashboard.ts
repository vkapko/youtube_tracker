import { Router } from 'express'
import { getDb } from '../db/database'

interface CountRow {
  count: number
}

interface RecentVideoRow {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  transcript_status: string
  created_at: string
  channel_name: string | null
}

interface FailedJobRow {
  id: number
  type: string
  payload: string
  error_message: string | null
  updated_at: string
}

const router = Router()

router.get('/', (_req, res) => {
  const db = getDb()
  const totalChannels = db.prepare('SELECT COUNT(*) AS count FROM channels').get() as CountRow
  const totalIndexedVideos = db.prepare(
    `SELECT COUNT(*) AS count FROM videos WHERE transcript_status = 'available'`,
  ).get() as CountRow
  const videosWithoutTranscripts = db.prepare(
    `SELECT COUNT(*) AS count FROM videos WHERE transcript_status != 'available'`,
  ).get() as CountRow
  const totalFailedIngestionJobs = db.prepare(
    `SELECT COUNT(*) AS count FROM ingestion_jobs WHERE status = 'failed'`,
  ).get() as CountRow

  const recentlyIngestedVideos = db.prepare(`
    SELECT
      v.youtube_video_id,
      v.title,
      v.thumbnail_url,
      v.transcript_status,
      v.created_at,
      c.name AS channel_name
    FROM videos v
    LEFT JOIN channels c ON c.id = v.channel_id
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT 10
  `).all() as RecentVideoRow[]

  const recentlyFailedJobs = db.prepare(`
    SELECT id, type, payload, error_message, updated_at
    FROM ingestion_jobs
    WHERE status = 'failed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 5
  `).all() as FailedJobRow[]

  res.json({
    totalChannels: totalChannels.count,
    totalIndexedVideos: totalIndexedVideos.count,
    videosWithoutTranscripts: videosWithoutTranscripts.count,
    totalFailedIngestionJobs: totalFailedIngestionJobs.count,
    recentlyIngestedVideos: recentlyIngestedVideos.map(video => ({
      youtubeVideoId: video.youtube_video_id,
      title: video.title,
      thumbnailUrl: video.thumbnail_url,
      transcriptStatus: video.transcript_status,
      ingestedAt: video.created_at,
      channelName: video.channel_name,
    })),
    recentlyFailedJobs: recentlyFailedJobs.map(job => ({
      id: job.id,
      type: job.type,
      payload: JSON.parse(job.payload) as object,
      errorMessage: job.error_message,
      failedAt: job.updated_at,
    })),
  })
})

export default router
