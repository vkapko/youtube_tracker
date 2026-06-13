import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  readTranscript: vi.fn(async () => [{ text: 'Hello', startSeconds: 0 }]),
}))

vi.mock('../src/services/chroma', () => ({
  ChromaService: class {
    async indexChunks() {}
    async resetCollection() {}
  },
}))

import app from '../src/app'
import { getDb } from '../src/db/database'
import * as youtubeApi from '../src/lib/youtubeApi'
import { jobQueue, setJobQueue, JobQueue } from '../src/services/jobQueue'
import { createIngestVideoWorker } from '../src/services/ingestWorker'
import type { TranscriptProvider, TranscriptAcquisitionResult, UnavailableReason } from '../src/services/transcript'
import { PythonTranscriptError } from '../src/services/pythonTranscriptProvider'

// ---------------------------------------------------------------------------
// Fake provider helpers
// ---------------------------------------------------------------------------

function fakeOkProvider(videoId = 'dQw4w9WgXcQ'): TranscriptProvider {
  return {
    getTranscript: vi.fn().mockResolvedValue({
      status: 'ok',
      transcript: {
        videoId,
        source: 'extractor',
        segments: [{ text: 'Hello', startSeconds: 0, durationSeconds: 2.0 }],
        plainText: 'Hello',
      },
    } satisfies TranscriptAcquisitionResult),
  }
}

function fakeUnavailableProvider(reason: UnavailableReason = 'no_requested_transcript'): TranscriptProvider {
  return {
    getTranscript: vi.fn().mockResolvedValue({
      status: 'unavailable',
      reason,
    } satisfies TranscriptAcquisitionResult),
  }
}

function fakeFailingProvider(error: Error): TranscriptProvider {
  return {
    getTranscript: vi.fn().mockRejectedValue(error),
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transcript extraction
// ---------------------------------------------------------------------------

describe('POST /api/videos/ingest — transcript extraction', () => {
  const mockFetchMeta = vi.mocked(youtubeApi.fetchVideoMetadata)

  beforeEach(() => {
    setJobQueue(new JobQueue({ ingest_video: createIngestVideoWorker(0, undefined, fakeOkProvider()) }))
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    mockFetchMeta.mockReset()
  })

  it('sets transcript_status to available when extraction succeeds', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)

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
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, fakeFailingProvider(new Error('Network error'))),
    }))

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

  it('sets transcript_status to failed and calls provider exactly once when request_blocked is thrown', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    const provider = fakeFailingProvider(new PythonTranscriptError('Blocked by YouTube', 'request_blocked', true))
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, provider),
    }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    expect(provider.getTranscript).toHaveBeenCalledTimes(1)

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('failed')
  })

  it('sets transcript_status to unavailable when provider returns unavailable outcome', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, fakeUnavailableProvider('no_requested_transcript')),
    }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('unavailable')
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

    const provider = fakeOkProvider()
    setJobQueue(new JobQueue({ ingest_video: createIngestVideoWorker(0, undefined, provider) }))
    mockFetchMeta.mockResolvedValue(baseMeta)

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    expect(provider.getTranscript).not.toHaveBeenCalled()

    const row = db.prepare(
      `SELECT transcript_status, transcript_file_path FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('available')
    expect(row.transcript_file_path).toBe('data/transcripts/UCtest/dQw4w9WgXcQ.txt')
  })

  it('persists error_code and retryable on the job when a retryable PythonTranscriptError is thrown', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, fakeFailingProvider(new PythonTranscriptError('Blocked by YouTube', 'request_blocked', true))),
    }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const job = db.prepare('SELECT status, error_code, retryable FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.status).toBe('failed')
    expect(job.error_code).toBe('request_blocked')
    expect(job.retryable).toBe(1)
  })

  it('persists error_code and retryable=0 when a non-retryable PythonTranscriptError is thrown', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, fakeFailingProvider(new PythonTranscriptError('Missing dep', 'dependency_error', false))),
    }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const job = db.prepare('SELECT status, error_code, retryable FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.status).toBe('failed')
    expect(job.error_code).toBe('dependency_error')
    expect(job.retryable).toBe(0)
  })

  it('leaves error_code and retryable null when a plain Error is thrown', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(0, undefined, fakeFailingProvider(new Error('Network error'))),
    }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const job = db.prepare('SELECT status, error_code, retryable FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.status).toBe('failed')
    expect(job.error_code).toBeNull()
    expect(job.retryable).toBeNull()
  })

  it('keeps transcript_status unavailable when hasCaptions is false', async () => {
    mockFetchMeta.mockResolvedValue({ ...baseMeta, hasCaptions: false })
    const provider = fakeOkProvider()
    setJobQueue(new JobQueue({ ingest_video: createIngestVideoWorker(0, undefined, provider) }))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    expect(provider.getTranscript).not.toHaveBeenCalled()

    const db = getDb()
    const row = db.prepare(
      `SELECT transcript_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(row.transcript_status).toBe('unavailable')
  })
})

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

describe('POST /api/videos/ingest — summarization', () => {
  const mockFetchMeta = vi.mocked(youtubeApi.fetchVideoMetadata)
  let mockSummarizeVideo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSummarizeVideo = vi.fn().mockResolvedValue({
      shortSummary: 'A great video about ML.',
      keyTopics: ['machine learning', 'neural networks'],
    })
    setJobQueue(new JobQueue({
      ingest_video: createIngestVideoWorker(
        0,
        { summarizeVideo: mockSummarizeVideo } as any,
        fakeOkProvider(),
      ),
    }))

    const db = getDb()
    db.prepare('DELETE FROM summaries').run()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    mockFetchMeta.mockReset()
  })

  it('stores summary rows and sets summary_status=available after successful ingest', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const video = db.prepare(
      `SELECT summary_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(video.summary_status).toBe('available')

    const summaries = db.prepare(
      `SELECT type, content FROM summaries ORDER BY type`
    ).all() as any[]
    expect(summaries).toHaveLength(2)
    expect(summaries.find(s => s.type === 'short')?.content).toBe('A great video about ML.')
    expect(JSON.parse(summaries.find(s => s.type === 'topics')?.content)).toEqual([
      'machine learning',
      'neural networks',
    ])
  })

  it('sets summary_status=failed when summarization throws, job still completes', async () => {
    mockFetchMeta.mockResolvedValue(baseMeta)
    mockSummarizeVideo.mockRejectedValue(new Error('Claude API unavailable'))

    const res = await request(app)
      .post('/api/videos/ingest')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    await jobQueue.waitForIdle()

    const db = getDb()
    const video = db.prepare(
      `SELECT transcript_status, summary_status FROM videos WHERE youtube_video_id = 'dQw4w9WgXcQ'`
    ).get() as any
    expect(video.transcript_status).toBe('available')
    expect(video.summary_status).toBe('failed')

    const summaries = db.prepare('SELECT * FROM summaries').all()
    expect(summaries).toHaveLength(0)
  })
})
