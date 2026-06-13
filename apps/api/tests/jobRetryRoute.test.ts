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
})
