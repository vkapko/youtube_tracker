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
  ChannelNotFoundError: class ChannelNotFoundError extends Error {},
  resolveChannel: vi.fn(),
  fetchChannelRecentVideoIds: vi.fn(),
  fetchVideoMetadata: vi.fn(),
}))

import app from '../src/app'
import { getDb } from '../src/db/database'
import * as youtubeApi from '../src/lib/youtubeApi'
import { ChannelNotFoundError } from '../src/lib/youtubeApi'
import { setJobQueue, JobQueue } from '../src/services/jobQueue'

const mockResolveChannel = vi.mocked(youtubeApi.resolveChannel)

const resolvedChannel = {
  youtubeChannelId: 'UCBcRF18a7Qf58cMAttLomGg',
  title: 'Marques Brownlee',
  handle: 'mkbhd',
  thumbnailUrl: 'https://example.com/thumb.jpg',
}

function clearDb() {
  const db = getDb()
  db.prepare('DELETE FROM ingestion_jobs').run()
  db.prepare('DELETE FROM videos').run()
  db.prepare('DELETE FROM channels').run()
}

describe('POST /api/channels', () => {
  beforeEach(() => {
    setJobQueue(new JobQueue({ channel_sync: async () => {} }))
    clearDb()
    mockResolveChannel.mockReset()
  })

  it('resolves a channel handle URL, stores the channel, and enqueues a sync job', async () => {
    mockResolveChannel.mockResolvedValue(resolvedChannel)

    const res = await request(app)
      .post('/api/channels')
      .send({ url: 'https://www.youtube.com/@mkbhd' })

    expect(res.status).toBe(202)
    expect(res.body.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
    expect(typeof res.body.channelId).toBe('number')
    expect(typeof res.body.jobId).toBe('number')

    const channel = getDb()
      .prepare('SELECT * FROM channels WHERE youtube_channel_id = ?')
      .get('UCBcRF18a7Qf58cMAttLomGg') as any
    expect(channel.name).toBe('Marques Brownlee')
    expect(channel.handle).toBe('mkbhd')
    expect(channel.thumbnail_url).toBe('https://example.com/thumb.jpg')

    const job = getDb()
      .prepare('SELECT type, payload FROM ingestion_jobs WHERE id = ?')
      .get(res.body.jobId) as any
    expect(job.type).toBe('channel_sync')
    expect(JSON.parse(job.payload)).toEqual({ youtubeChannelId: 'UCBcRF18a7Qf58cMAttLomGg' })
  })

  it('accepts a bare @handle', async () => {
    mockResolveChannel.mockResolvedValue(resolvedChannel)

    const res = await request(app)
      .post('/api/channels')
      .send({ url: '@mkbhd' })

    expect(res.status).toBe(202)
    expect(res.body.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
  })

  it('returns 400 for missing url', async () => {
    const res = await request(app).post('/api/channels').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/url/)
  })

  it('returns 400 for unresolvable input', async () => {
    const res = await request(app).post('/api/channels').send({ url: 'not-a-channel' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid/i)
  })

  it('returns 502 when YouTube API fails', async () => {
    mockResolveChannel.mockRejectedValue(new Error('YouTube quota exceeded'))

    const res = await request(app)
      .post('/api/channels')
      .send({ url: '@mkbhd' })

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/YouTube quota exceeded/)
  })

  it('returns 404 when a valid channel input does not exist', async () => {
    mockResolveChannel.mockRejectedValue(new ChannelNotFoundError('No channel found for: missing'))

    const res = await request(app)
      .post('/api/channels')
      .send({ url: '@missing' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('No channel found for: missing')
  })

  it('resolves a /channel/UCxxx URL', async () => {
    mockResolveChannel.mockResolvedValue(resolvedChannel)

    const res = await request(app)
      .post('/api/channels')
      .send({ url: 'https://www.youtube.com/channel/UCBcRF18a7Qf58cMAttLomGg' })

    expect(res.status).toBe(202)
    expect(res.body.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
  })

  it('resolves a /c/name URL and calls resolveChannel with customUrl type', async () => {
    mockResolveChannel.mockResolvedValue(resolvedChannel)

    const res = await request(app)
      .post('/api/channels')
      .send({ url: 'https://www.youtube.com/c/mkbhd' })

    expect(res.status).toBe(202)
    expect(mockResolveChannel).toHaveBeenCalledWith({ type: 'customUrl', value: 'mkbhd' })
  })

  it('handles adding a channel that is already tracked without error', async () => {
    mockResolveChannel.mockResolvedValue(resolvedChannel)

    await request(app).post('/api/channels').send({ url: '@mkbhd' })
    const res = await request(app).post('/api/channels').send({ url: '@mkbhd' })

    expect(res.status).toBe(202)
    const count = (getDb().prepare('SELECT COUNT(*) as n FROM channels').get() as any).n
    expect(count).toBe(1)
  })
})

describe('GET /api/channels', () => {
  beforeEach(() => {
    clearDb()
  })

  it('returns channels ordered alphabetically by name', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UCz', 'Zebra Channel')`).run()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UCa', 'Alpha Channel')`).run()

    const res = await request(app).get('/api/channels')

    expect(res.status).toBe(200)
    expect(res.body.channels.map((c: any) => c.name)).toEqual(['Alpha Channel', 'Zebra Channel'])
  })

  it('returns channels with handle, last_checked_at, indexed_video_count, failed_transcript_count', async () => {
    const db = getDb()
    db.prepare(
      `INSERT INTO channels (youtube_channel_id, name, handle, thumbnail_url, last_checked_at)
       VALUES ('UCtest', 'Test Channel', 'testhandle', 'https://example.com/t.jpg', '2026-06-01T00:00:00')`
    ).run()
    const { lastInsertRowid: channelRowId } = db.prepare(
      `SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`
    ).get() as any
    const channelRow = db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`).get() as any

    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status) VALUES (?, ?, ?, ?)`
    ).run('vid1', channelRow.id, 'Video 1', 'available')
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status) VALUES (?, ?, ?, ?)`
    ).run('vid2', channelRow.id, 'Video 2', 'available')
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status) VALUES (?, ?, ?, ?)`
    ).run('vid3', channelRow.id, 'Video 3', 'failed')

    const res = await request(app).get('/api/channels')

    expect(res.status).toBe(200)
    const ch = res.body.channels[0]
    expect(ch.handle).toBe('testhandle')
    expect(ch.last_checked_at).toBe('2026-06-01T00:00:00')
    expect(ch.indexed_video_count).toBe(2)
    expect(ch.failed_transcript_count).toBe(1)
  })
})

describe('GET /api/channels/:id', () => {
  beforeEach(() => {
    clearDb()
  })

  it('returns channel detail with its videos', async () => {
    const db = getDb()
    db.prepare(
      `INSERT INTO channels (youtube_channel_id, name, handle) VALUES ('UCtest', 'Test Channel', 'testhandle')`
    ).run()
    const channelRow = db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`).get() as any
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status, summary_status) VALUES (?, ?, ?, ?, ?)`
    ).run('vid1', channelRow.id, 'Video 1', 'available', 'completed')
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status, summary_status) VALUES (?, ?, ?, ?, ?)`
    ).run('vid2', channelRow.id, 'Video 2', 'failed', 'pending')

    const res = await request(app).get(`/api/channels/${channelRow.id}`)

    expect(res.status).toBe(200)
    expect(res.body.channel.name).toBe('Test Channel')
    expect(res.body.channel.handle).toBe('testhandle')
    expect(res.body.videos).toHaveLength(2)
    expect(res.body.videos[0].youtube_video_id).toBe('vid1')
    expect(res.body.videos[0].transcript_status).toBe('available')
  })

  it('returns 404 for unknown channel', async () => {
    const res = await request(app).get('/api/channels/99999')
    expect(res.status).toBe(404)
  })

  it('returns videos ordered by published_at descending', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UCord', 'Order Test')`).run()
    const { id: channelId } = db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCord'`).get() as any
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status, published_at) VALUES (?, ?, ?, ?, ?)`
    ).run('older', channelId, 'Older Video', 'pending', '2024-01-01')
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status, published_at) VALUES (?, ?, ?, ?, ?)`
    ).run('newer', channelId, 'Newer Video', 'pending', '2025-06-01')

    const res = await request(app).get(`/api/channels/${channelId}`)

    expect(res.status).toBe(200)
    expect(res.body.videos[0].youtube_video_id).toBe('newer')
    expect(res.body.videos[1].youtube_video_id).toBe('older')
  })
})

describe('POST /api/channels/:id/sync', () => {
  beforeEach(() => {
    setJobQueue(new JobQueue({ channel_sync: async () => {} }))
    clearDb()
  })

  it('enqueues a channel_sync job and returns 202 with jobId and channelId', async () => {
    const db = getDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UCsync', 'Sync Test')`).run()
    const { id: channelId } = db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCsync'`).get() as any

    const res = await request(app).post(`/api/channels/${channelId}/sync`)

    expect(res.status).toBe(202)
    expect(typeof res.body.jobId).toBe('number')
    expect(res.body.channelId).toBe(channelId)

    const job = db.prepare('SELECT type, payload FROM ingestion_jobs WHERE id = ?').get(res.body.jobId) as any
    expect(job.type).toBe('channel_sync')
    expect(JSON.parse(job.payload)).toEqual({ youtubeChannelId: 'UCsync' })
  })

  it('returns 404 for unknown channel id', async () => {
    const res = await request(app).post('/api/channels/99999/sync')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })
})
