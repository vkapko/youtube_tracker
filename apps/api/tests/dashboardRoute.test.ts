import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

import app from '../src/app'
import { getDb } from '../src/db/database'

function clearDb() {
  const db = getDb()
  db.prepare('DELETE FROM ingestion_jobs').run()
  db.prepare('DELETE FROM videos').run()
  db.prepare('DELETE FROM channels').run()
}

describe('GET /api/dashboard', () => {
  beforeEach(clearDb)

  it('returns knowledge base totals and recent activity', async () => {
    const db = getDb()
    const firstChannel = db.prepare(
      `INSERT INTO channels (youtube_channel_id, name) VALUES ('UC1', 'First Channel')`,
    ).run()
    db.prepare(
      `INSERT INTO channels (youtube_channel_id, name) VALUES ('UC2', 'Second Channel')`,
    ).run()

    for (let index = 1; index <= 12; index++) {
      db.prepare(`
        INSERT INTO videos (
          youtube_video_id, channel_id, title, thumbnail_url,
          transcript_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `video-${index}`,
        Number(firstChannel.lastInsertRowid),
        `Video ${index}`,
        `https://example.com/${index}.jpg`,
        index <= 8 ? 'available' : 'failed',
        `2026-06-${String(index).padStart(2, '0')} 12:00:00`,
      )
    }

    for (let index = 1; index <= 7; index++) {
      db.prepare(`
        INSERT INTO ingestion_jobs (
          type, status, payload, error_message, updated_at
        ) VALUES ('ingest_video', 'failed', ?, ?, ?)
      `).run(
        JSON.stringify({ youtubeVideoId: `failed-${index}` }),
        `Failure ${index}`,
        `2026-06-${String(index).padStart(2, '0')} 13:00:00`,
      )
    }

    const response = await request(app).get('/api/dashboard')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      totalChannels: 2,
      totalIndexedVideos: 8,
      videosWithoutTranscripts: 4,
      totalFailedIngestionJobs: 7,
    })
    expect(response.body.recentlyIngestedVideos).toHaveLength(10)
    expect(response.body.recentlyIngestedVideos[0]).toMatchObject({
      youtubeVideoId: 'video-12',
      title: 'Video 12',
      channelName: 'First Channel',
    })
    expect(response.body.recentlyFailedJobs).toHaveLength(5)
    expect(response.body.recentlyFailedJobs[0]).toMatchObject({
      errorMessage: 'Failure 7',
      type: 'ingest_video',
    })
  })

  it('includes errorCode and retryable=false for non-retryable structured failures', async () => {
    getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message, error_code, retryable, updated_at)
      VALUES ('ingest_video', 'failed', '{"youtubeVideoId":"dep-fail"}', 'Missing dep', 'dependency_error', 0, '2026-06-13 10:00:00')
    `).run()

    const response = await request(app).get('/api/dashboard')
    expect(response.status).toBe(200)
    const [failedJob] = response.body.recentlyFailedJobs
    expect(failedJob.errorCode).toBe('dependency_error')
    expect(failedJob.retryable).toBe(false)
  })

  it('includes errorCode and retryable=true for retryable structured failures', async () => {
    getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message, error_code, retryable, updated_at)
      VALUES ('ingest_video', 'failed', '{"youtubeVideoId":"blocked"}', 'Blocked', 'request_blocked', 1, '2026-06-13 10:00:00')
    `).run()

    const response = await request(app).get('/api/dashboard')
    expect(response.status).toBe(200)
    const [failedJob] = response.body.recentlyFailedJobs
    expect(failedJob.errorCode).toBe('request_blocked')
    expect(failedJob.retryable).toBe(true)
  })

  it('includes null errorCode and retryable for unstructured failures', async () => {
    getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message, updated_at)
      VALUES ('ingest_video', 'failed', '{"youtubeVideoId":"plain-fail"}', 'Unknown error', '2026-06-13 09:00:00')
    `).run()

    const response = await request(app).get('/api/dashboard')
    expect(response.status).toBe(200)
    const [failedJob] = response.body.recentlyFailedJobs
    expect(failedJob.errorCode).toBeNull()
    expect(failedJob.retryable).toBeNull()
  })
})
