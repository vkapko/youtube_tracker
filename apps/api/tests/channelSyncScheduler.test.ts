import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

import { getDb } from '../src/db/database'
import { JobQueue } from '../src/services/jobQueue'
import { startChannelSyncScheduler } from '../src/services/channelSyncScheduler'

describe('startChannelSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    process.env.SYNC_INTERVAL_HOURS = '2'
    const db = getDb()
    db.prepare('DELETE FROM ingestion_jobs').run()
    db.prepare('DELETE FROM channels').run()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.SYNC_INTERVAL_HOURS
  })

  it('queues a channel sync for every tracked channel on the configured interval', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UC1', 'One')`).run()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UC2', 'Two')`).run()
    const queue = new JobQueue({ channel_sync: async () => {} })

    const stop = startChannelSyncScheduler(queue)

    expect(db.prepare(`SELECT COUNT(*) AS count FROM ingestion_jobs`).get()).toEqual({ count: 0 })

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    await queue.waitForIdle()

    const jobs = db.prepare(`
      SELECT type, payload FROM ingestion_jobs ORDER BY id
    `).all() as Array<{ type: string; payload: string }>
    expect(jobs.map(job => ({
      type: job.type,
      payload: JSON.parse(job.payload),
    }))).toEqual([
      { type: 'channel_sync', payload: { youtubeChannelId: 'UC1' } },
      { type: 'channel_sync', payload: { youtubeChannelId: 'UC2' } },
    ])

    stop()
  })

  it('defaults to a 24-hour interval', async () => {
    delete process.env.SYNC_INTERVAL_HOURS
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UC1', 'One')`).run()
    const queue = new JobQueue({ channel_sync: async () => {} })

    const stop = startChannelSyncScheduler(queue)
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ingestion_jobs`).get()).toEqual({ count: 0 })

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    await queue.waitForIdle()
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ingestion_jobs`).get()).toEqual({ count: 1 })

    stop()
  })
})
