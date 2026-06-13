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
import { JobQueue, setJobQueue } from '../src/services/jobQueue'

describe('POST /api/jobs/:id/retry', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM ingestion_jobs').run()
  })

  it('queues a new job with the failed job type and payload', async () => {
    const processedPayloads: string[] = []
    const queue = new JobQueue({
      ingest_video: async job => {
        processedPayloads.push(job.payload)
      },
    })
    setJobQueue(queue)

    const payload = JSON.stringify({ youtubeVideoId: 'retry-me' })
    const failed = getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message)
      VALUES ('ingest_video', 'failed', ?, 'Temporary failure')
    `).run(payload)

    const response = await request(app).post(`/api/jobs/${failed.lastInsertRowid}/retry`)
    await queue.waitForIdle()

    expect(response.status).toBe(202)
    expect(response.body.originalJobId).toBe(Number(failed.lastInsertRowid))
    expect(typeof response.body.jobId).toBe('number')
    expect(response.body.jobId).not.toBe(response.body.originalJobId)
    expect(processedPayloads).toEqual([payload])
  })

  it('returns 409 when retryable is false and force is not set', async () => {
    setJobQueue(new JobQueue({ ingest_video: async () => {} }))

    const payload = JSON.stringify({ youtubeVideoId: 'blocked-video' })
    const failed = getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message, error_code, retryable)
      VALUES ('ingest_video', 'failed', ?, 'Missing dep', 'dependency_error', 0)
    `).run(payload)

    const response = await request(app).post(`/api/jobs/${failed.lastInsertRowid}/retry`)
    expect(response.status).toBe(409)
  })

  it('queues the job when retryable is false but force=true', async () => {
    const processedPayloads: string[] = []
    const queue = new JobQueue({
      ingest_video: async job => { processedPayloads.push(job.payload) },
    })
    setJobQueue(queue)

    const payload = JSON.stringify({ youtubeVideoId: 'blocked-video' })
    const failed = getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_message, error_code, retryable)
      VALUES ('ingest_video', 'failed', ?, 'Missing dep', 'dependency_error', 0)
    `).run(payload)

    const response = await request(app)
      .post(`/api/jobs/${failed.lastInsertRowid}/retry`)
      .send({ force: true })
    await queue.waitForIdle()

    expect(response.status).toBe(202)
    expect(processedPayloads).toHaveLength(1)
  })

  it('allows retry when retryable is null (backward compatibility)', async () => {
    setJobQueue(new JobQueue({ ingest_video: async () => {} }))

    const payload = JSON.stringify({ youtubeVideoId: 'unspecified' })
    const failed = getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload)
      VALUES ('ingest_video', 'failed', ?)
    `).run(payload)

    const response = await request(app).post(`/api/jobs/${failed.lastInsertRowid}/retry`)
    expect(response.status).toBe(202)
  })

  it('allows retry when retryable is true', async () => {
    setJobQueue(new JobQueue({ ingest_video: async () => {} }))

    const payload = JSON.stringify({ youtubeVideoId: 'retryable-video' })
    const failed = getDb().prepare(`
      INSERT INTO ingestion_jobs (type, status, payload, error_code, retryable)
      VALUES ('ingest_video', 'failed', ?, 'request_blocked', 1)
    `).run(payload)

    const response = await request(app).post(`/api/jobs/${failed.lastInsertRowid}/retry`)
    expect(response.status).toBe(202)
  })
})
