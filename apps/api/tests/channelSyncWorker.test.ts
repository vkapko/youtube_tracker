import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

vi.mock('../src/lib/youtubeApi', () => ({
  resolveChannel: vi.fn(),
  fetchChannelRecentVideoIds: vi.fn(),
  fetchVideoMetadata: vi.fn(),
}))

import { getDb } from '../src/db/database'
import * as youtubeApi from '../src/lib/youtubeApi'
import { createChannelSyncWorker } from '../src/services/channelSyncWorker'
import { setJobQueue, JobQueue, type JobRow } from '../src/services/jobQueue'

const mockFetchRecentIds = vi.mocked(youtubeApi.fetchChannelRecentVideoIds)

function clearDb() {
  const db = getDb()
  db.prepare('DELETE FROM ingestion_jobs').run()
  db.prepare('DELETE FROM videos').run()
  db.prepare('DELETE FROM channels').run()
}

function insertChannel(youtubeChannelId = 'UCtest') {
  const db = getDb()
  db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES (?, 'Test Channel')`).run(youtubeChannelId)
  return (db.prepare('SELECT id FROM channels WHERE youtube_channel_id = ?').get(youtubeChannelId) as any).id
}

function makeJobRow(youtubeChannelId: string): JobRow {
  return {
    id: 1,
    type: 'channel_sync',
    status: 'running',
    stage: null,
    payload: JSON.stringify({ youtubeChannelId }),
    error_message: null,
  }
}

describe('createChannelSyncWorker', () => {
  beforeEach(() => {
    clearDb()
    mockFetchRecentIds.mockReset()
    setJobQueue(new JobQueue({ ingest_video: async () => {} }))
  })

  it('calls setStage with fetching_videos before fetching', async () => {
    insertChannel()
    mockFetchRecentIds.mockResolvedValue([])
    const setStage = vi.fn()
    await createChannelSyncWorker()(makeJobRow('UCtest'), setStage)
    expect(setStage).toHaveBeenCalledWith('fetching_videos')
  })

  it('creates ingest_video jobs for each new video', async () => {
    insertChannel()
    mockFetchRecentIds.mockResolvedValue([{ videoId: 'vid1', publishedAt: '2024-01-01T00:00:00Z' }, { videoId: 'vid2', publishedAt: '2024-01-02T00:00:00Z' }])

    await createChannelSyncWorker()(makeJobRow('UCtest'), vi.fn())

    const jobs = getDb()
      .prepare("SELECT payload FROM ingestion_jobs WHERE type = 'ingest_video'")
      .all() as any[]
    expect(jobs).toHaveLength(2)
    const enqueued = jobs.map(j => JSON.parse(j.payload).youtubeVideoId)
    expect(enqueued).toContain('vid1')
    expect(enqueued).toContain('vid2')
  })

  it('skips videos already present in the database', async () => {
    const channelId = insertChannel()
    getDb()
      .prepare(`INSERT INTO videos (youtube_video_id, channel_id, title) VALUES ('existing', ?, 'Existing')`)
      .run(channelId)
    mockFetchRecentIds.mockResolvedValue([{ videoId: 'existing', publishedAt: '2024-01-01T00:00:00Z' }, { videoId: 'brand-new', publishedAt: '2024-01-02T00:00:00Z' }])

    await createChannelSyncWorker()(makeJobRow('UCtest'), vi.fn())

    const jobs = getDb()
      .prepare("SELECT payload FROM ingestion_jobs WHERE type = 'ingest_video'")
      .all() as any[]
    expect(jobs).toHaveLength(1)
    expect(JSON.parse(jobs[0].payload).youtubeVideoId).toBe('brand-new')
  })

  it('creates no jobs when all fetched videos already exist', async () => {
    const channelId = insertChannel()
    getDb().prepare(`INSERT INTO videos (youtube_video_id, channel_id, title) VALUES ('v1', ?, 'V1')`).run(channelId)
    getDb().prepare(`INSERT INTO videos (youtube_video_id, channel_id, title) VALUES ('v2', ?, 'V2')`).run(channelId)
    mockFetchRecentIds.mockResolvedValue([{ videoId: 'v1', publishedAt: '2024-01-01T00:00:00Z' }, { videoId: 'v2', publishedAt: '2024-01-02T00:00:00Z' }])

    await createChannelSyncWorker()(makeJobRow('UCtest'), vi.fn())

    const count = (
      getDb().prepare("SELECT COUNT(*) as n FROM ingestion_jobs WHERE type = 'ingest_video'").get() as any
    ).n
    expect(count).toBe(0)
  })

  it('updates last_checked_at on the channel after syncing', async () => {
    insertChannel()
    mockFetchRecentIds.mockResolvedValue([])

    await createChannelSyncWorker()(makeJobRow('UCtest'), vi.fn())

    const row = getDb()
      .prepare('SELECT last_checked_at FROM channels WHERE youtube_channel_id = ?')
      .get('UCtest') as any
    expect(row.last_checked_at).toBeTruthy()
  })

  it('skips videos that already have a queued or running ingest_video job', async () => {
    insertChannel()
    // Simulate a queued job for vid1 (e.g. from a concurrent sync)
    getDb()
      .prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'queued', ?)`)
      .run(JSON.stringify({ youtubeVideoId: 'vid1' }))
    getDb()
      .prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'running', ?)`)
      .run(JSON.stringify({ youtubeVideoId: 'vid2' }))
    mockFetchRecentIds.mockResolvedValue([
      { videoId: 'vid1', publishedAt: '2024-01-01T00:00:00Z' },
      { videoId: 'vid2', publishedAt: '2024-01-02T00:00:00Z' },
      { videoId: 'vid3', publishedAt: '2024-01-03T00:00:00Z' },
    ])

    await createChannelSyncWorker()(makeJobRow('UCtest'), vi.fn())

    // vid1 and vid2 must not be duplicated; only vid3 should have been newly created
    const jobs = getDb()
      .prepare("SELECT payload FROM ingestion_jobs WHERE type = 'ingest_video'")
      .all() as any[]
    const videoIds = jobs.map(j => JSON.parse(j.payload).youtubeVideoId)
    expect(videoIds).toHaveLength(3)
    expect(videoIds.filter(id => id === 'vid1')).toHaveLength(1)
    expect(videoIds.filter(id => id === 'vid2')).toHaveLength(1)
    expect(videoIds).toContain('vid3')
  })

  it('deduplication is global across channels, not per-channel', async () => {
    const channelA = insertChannel('UCA')
    insertChannel('UCB')
    // vid1 belongs to channelA
    getDb()
      .prepare(`INSERT INTO videos (youtube_video_id, channel_id, title) VALUES ('vid1', ?, 'V1')`)
      .run(channelA)
    // UCB's sync returns vid1 (same ID) and vid2 (new)
    mockFetchRecentIds.mockResolvedValue([{ videoId: 'vid1', publishedAt: '2024-01-01T00:00:00Z' }, { videoId: 'vid2', publishedAt: '2024-01-02T00:00:00Z' }])

    await createChannelSyncWorker()(makeJobRow('UCB'), vi.fn())

    const jobs = getDb()
      .prepare("SELECT payload FROM ingestion_jobs WHERE type = 'ingest_video'")
      .all() as any[]
    expect(jobs).toHaveLength(1)
    expect(JSON.parse(jobs[0].payload).youtubeVideoId).toBe('vid2')
  })
})
