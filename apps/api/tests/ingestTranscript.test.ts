import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: vi.fn() },
}))

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

vi.mock('../src/lib/youtubeApi', () => ({
  fetchVideoMetadata: vi.fn(),
}))

vi.mock('../src/services/transcriptFile', () => ({
  saveTranscript: vi.fn(async () => 'data/transcripts/UCtest/dQw4w9WgXcQ.txt'),
}))

import app from '../src/app'
import { getDb } from '../src/db/database'
import * as youtubeApi from '../src/lib/youtubeApi'
import * as ytLib from 'youtube-transcript'
import { jobQueue, setJobQueue, JobQueue } from '../src/services/jobQueue'
import { createIngestVideoWorker } from '../src/services/ingestWorker'

const baseMeta = {
  youtubeVideoId: 'dQw4w9WgXcQ',
  channelId: 'UCtest',
  channelTitle: 'Test Channel',
  title: 'Test Video',
  description: '',
  publishedAt: '2026-01-01',
  durationSeconds: 120,
  thumbnailUrl: '',
  hasCaptions: true,
}

describe('POST /api/videos/ingest — transcript extraction', () => {
  const mockFetchMeta = vi.mocked(youtubeApi.fetchVideoMetadata)
  const mockFetchTranscript = vi.mocked(ytLib.YoutubeTranscript.fetchTranscript)

  beforeEach(() => {
    setJobQueue(new JobQueue({ ingest_video: createIngestVideoWorker(0) }))
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    mockFetchMeta.mockReset()
    mockFetchTranscript.mockReset()
  })

  it('sets transcript_status to available when extraction succeeds', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockResolvedValue([
      { text: 'Hello', offset: 0, duration: 2000 },
    ])

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status, transcript_file_path FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('available')
    expect(row.transcript_file_path).toBe('data/transcripts/UCtest/dQw4w9WgXcQ.txt')
  })

  it('sets transcript_status to failed when extraction throws', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockRejectedValue(new Error('Network error'))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('failed')
  })

  it('preserves available transcript status and skips extraction when re-ingesting', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UCtest', 'Test Channel') ON CONFLICT DO NOTHING`).run()
    const { id: channelId } = db.prepare(
      `SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`
    ).get() as { id: number }
    db.prepare(`
      INSERT INTO videos (youtube_video_id, channel_id, title, has_captions, transcript_status, transcript_file_path)
      VALUES ('dQw4w9WgXcQ', ?, 'Old Title', 1, 'available', 'data/transcripts/UCtest/dQw4w9WgXcQ.txt')
    `).run(channelId)

    mockFetchMeta.mockResolvedValue(baseMeta)

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    expect(mockFetchTranscript).not.toHaveBeenCalled()

    const row = db.prepare(
      `SELECT transcript_status, transcript_file_path FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('available')
    expect(row.transcript_file_path).toBe('data/transcripts/UCtest/dQw4w9WgXcQ.txt')
  })

  it('keeps transcript_status unavailable when hasCaptions is false', async () => {
    mockFetchMeta.mockResolvedValue({ ...baseMeta, hasCaptions: false })

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    expect(mockFetchTranscript).not.toHaveBeenCalled()

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('unavailable')
  })
})
