import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

vi.mock('../src/lib/youtubeApi', () => ({ fetchVideoMetadata: vi.fn() }))
vi.mock('../src/services/transcriptFile', () => ({ saveTranscript: vi.fn(async () => 'path/x.txt') }))
vi.mock('youtube-transcript', () => ({ YoutubeTranscript: { fetchTranscript: vi.fn() } }))
vi.mock('../src/services/chroma', () => ({
  ChromaService: class {
    async indexChunks() {}
    async resetCollection() {}
  },
}))

import { getDb } from '../src/db/database'
import { JobQueue } from '../src/services/jobQueue'
import { createIngestVideoWorker } from '../src/services/ingestWorker'
import * as youtubeApi from '../src/lib/youtubeApi'
import * as ytLib from 'youtube-transcript'

const baseMeta = {
  youtubeVideoId: 'abc123',
  channelId: 'UCtest',
  channelTitle: 'Test Channel',
  title: 'Test Video',
  description: '',
  publishedAt: '2026-01-01',
  durationSeconds: 60,
  thumbnailUrl: '',
  hasCaptions: true,
}

function getJobsToRehydrate() {
  return getDb()
    .prepare(`SELECT * FROM ingestion_jobs WHERE status IN ('queued', 'running')`)
    .all()
}

describe('re-hydration query', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    vi.mocked(youtubeApi.fetchVideoMetadata).mockReset()
    vi.mocked(ytLib.YoutubeTranscript.fetchTranscript).mockReset()
  })

  it('returns all queued and running rows', () => {
    const db = getDb()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'queued', '{}')`).run()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'running', '{}')`).run()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'completed', '{}')`).run()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'failed', '{}')`).run()

    const rows = getJobsToRehydrate() as any[]
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.status)).toEqual(expect.arrayContaining(['queued', 'running']))
  })

  it('returns empty array when no pending jobs exist', () => {
    getDb().prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'completed', '{}')`).run()
    expect(getJobsToRehydrate()).toHaveLength(0)
  })
})

describe('rehydrate()', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM transcript_chunks').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
    vi.mocked(youtubeApi.fetchVideoMetadata).mockReset()
    vi.mocked(ytLib.YoutubeTranscript.fetchTranscript).mockReset()
  })

  it('resets running jobs to queued and processes all pending jobs', async () => {
    vi.mocked(youtubeApi.fetchVideoMetadata).mockResolvedValue(baseMeta)
    vi.mocked(ytLib.YoutubeTranscript.fetchTranscript).mockResolvedValue([
      { text: 'hello', offset: 0, duration: 1000 },
    ])

    const db = getDb()
    const payload = JSON.stringify({ youtubeVideoId: 'abc123' })
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'running', ?)`).run(payload)
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'queued', ?)`).run(payload)

    const q = new JobQueue({ ingest_video: createIngestVideoWorker(0) })
    q.rehydrate()
    await q.waitForIdle()

    const jobs = db.prepare('SELECT id, status FROM ingestion_jobs ORDER BY id').all() as any[]
    expect(jobs).toHaveLength(2)
    expect(jobs.every(j => j.status === 'completed')).toBe(true)
  })

  it('leaves completed and failed jobs untouched', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'completed', '{}')`).run()
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'failed', '{}')`).run()

    const q = new JobQueue({ ingest_video: createIngestVideoWorker(0) })
    q.rehydrate()
    await q.waitForIdle()

    const jobs = db.prepare('SELECT status FROM ingestion_jobs ORDER BY id').all() as any[]
    expect(jobs[0]).toMatchObject({ status: 'completed' })
    expect(jobs[1]).toMatchObject({ status: 'failed' })
  })
})
