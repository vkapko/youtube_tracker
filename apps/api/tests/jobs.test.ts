import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'

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

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: vi.fn() },
}))

const { mockIndexChunks } = vi.hoisted(() => ({
  mockIndexChunks: vi.fn(async () => {}),
}))

vi.mock('../src/services/chroma', () => ({
  ChromaService: class {
    indexChunks = mockIndexChunks
    async resetCollection() {}
  },
}))

import app from '../src/app'
import { getDb } from '../src/db/database'
import * as youtubeApi from '../src/lib/youtubeApi'
import * as ytLib from 'youtube-transcript'
import { jobQueue, setJobQueue, JobQueue } from '../src/services/jobQueue'
import { createIngestVideoWorker } from '../src/services/ingestWorker'
import type { JobRow } from '../src/services/jobQueue'

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

describe('POST /api/videos/ingest', () => {
  const mockFetchMeta = vi.mocked(youtubeApi.fetchVideoMetadata)
  const mockFetchTranscript = vi.mocked(ytLib.YoutubeTranscript.fetchTranscript)

  beforeEach(() => {
    setJobQueue(new JobQueue({ ingest_video: createIngestVideoWorker(0) }))
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    mockFetchMeta.mockReset()
    mockFetchTranscript.mockReset()
    mockIndexChunks.mockReset()
    mockIndexChunks.mockResolvedValue(undefined)
  })

  it('job transitions to completed after successful ingest', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockResolvedValue([{ text: 'Hello', offset: 0, duration: 2000 }])

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const job = getDb().prepare('SELECT status FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.status).toBe('completed')

    const video = getDb().prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(video.transcript_status).toBe('available')
  })

  it('stores transcript chunks after saving the transcript', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockResolvedValue([
      { text: 'First sentence.', offset: 0, duration: 2000 },
      { text: 'Second sentence.', offset: 5000, duration: 2000 },
    ])

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    await jobQueue.waitForIdle()

    const rows = getDb().prepare(`
      SELECT tc.chunk_index, tc.chroma_document_id
      FROM transcript_chunks tc
      JOIN videos v ON v.id = tc.video_id
      WHERE v.youtube_video_id = 'dQw4w9WgXcQ'
    `).all() as Array<{ chunk_index: number; chroma_document_id: string }>

    expect(res.status).toBe(202)
    expect(rows).toEqual([{ chunk_index: 0, chroma_document_id: 'dQw4w9WgXcQ:0' }])
  })

  it('does not mark the transcript available when Chroma indexing fails', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockResolvedValue([
      { text: 'Transcript sentence.', offset: 0, duration: 2000 },
    ])
    mockIndexChunks.mockRejectedValue(new Error('Chroma unavailable'))

    await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    await jobQueue.waitForIdle()

    const video = getDb().prepare(`
      SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'
    `).get() as { transcript_status: string }

    expect(video.transcript_status).toBe('failed')
  })

  it('job transitions to failed with error_message when transcript fetch throws', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockRejectedValue(new Error('Transcript unavailable'))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const job = getDb().prepare('SELECT status, error_message FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.status).toBe('failed')
    expect(job.error_message).toBe('Transcript unavailable')
  })

  it('creates a queued job and returns jobId immediately', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockFetchTranscript.mockResolvedValue([{ text: 'Hello', offset: 0, duration: 2000 }])

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    expect(typeof res.body.jobId).toBe('number')
    expect(res.body.youtubeVideoId).toBe('dQw4w9WgXcQ')

    const job = getDb().prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job).toBeTruthy()
    expect(job.type).toBe('ingest_video')
    expect(['queued', 'running', 'completed']).toContain(job.status)
  })
})

describe('GET /api/jobs/:id', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM ingestion_jobs').run()
  })

  it('returns a job by id', async () => {
    const db = getDb()
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'queued', '{"youtubeVideoId":"abc123"}')`
    ).run()

    const res = await request(app).get(`/api/jobs/${lastInsertRowid}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(Number(lastInsertRowid))
    expect(res.body.status).toBe('queued')
    expect(res.body.type).toBe('ingest_video')
    expect(res.body.error_message).toBeNull()
  })

  it('returns 404 for unknown job id', async () => {
    const res = await request(app).get('/api/jobs/99999')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/channels/:id/sync', () => {
  beforeEach(() => {
    setJobQueue(new JobQueue({ channel_sync: async () => {} }))
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('creates a channel_sync job before processing begins', async () => {
    const { lastInsertRowid } = getDb().prepare(
      `INSERT INTO channels (youtube_channel_id, name) VALUES ('UCtest', 'Test Channel')`
    ).run()

    const res = await request(app).post(`/api/channels/${lastInsertRowid}/sync`)

    expect(res.status).toBe(202)
    expect(typeof res.body.jobId).toBe('number')

    const job = getDb().prepare(
      'SELECT type, payload FROM ingestion_jobs WHERE id = ?'
    ).get(res.body.jobId) as { type: string; payload: string }
    expect(job.type).toBe('channel_sync')
    expect(JSON.parse(job.payload)).toEqual({ youtubeChannelId: 'UCtest' })
  })

  it('returns 404 for an unknown channel', async () => {
    const res = await request(app).post('/api/channels/99999/sync')
    expect(res.status).toBe(404)
  })
})

describe('ingest progress stages', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('emits the complete ingestion stage sequence', async () => {
    vi.mocked(youtubeApi.fetchVideoMetadata).mockResolvedValue(baseMeta)
    vi.mocked(ytLib.YoutubeTranscript.fetchTranscript).mockResolvedValue([
      { text: 'Hello', offset: 0, duration: 2000 },
    ])

    const stages: string[] = []
    const job: JobRow = {
      id: 1,
      type: 'ingest_video',
      status: 'running',
      stage: null,
      payload: JSON.stringify({ youtubeVideoId: baseMeta.youtubeVideoId }),
      error_message: null,
    }

    await createIngestVideoWorker(0)(job, stage => stages.push(stage))

    expect(stages).toEqual([
      'fetching_metadata',
      'fetching_transcript',
      'indexing',
      'summarising',
    ])
  })
})
