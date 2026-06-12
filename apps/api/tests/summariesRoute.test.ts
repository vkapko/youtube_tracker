import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

const mockSummarizeVideo = vi.hoisted(() => vi.fn())

vi.mock('../src/services/claude.service', () => ({
  ClaudeService: class {
    summarizeVideo = mockSummarizeVideo
  },
}))

const mockReadTranscript = vi.hoisted(() => vi.fn())

vi.mock('../src/services/transcriptFile', () => ({
  readTranscript: mockReadTranscript,
}))

import app from '../src/app'
import { getDb } from '../src/db/database'

function seedVideo(
  db: ReturnType<typeof getDb>,
  opts: {
    youtubeVideoId?: string
    summaryStatus?: string
    transcriptStatus?: string
    transcriptFilePath?: string | null
  } = {}
) {
  const youtubeVideoId = opts.youtubeVideoId ?? 'abc123'
  const summaryStatus = opts.summaryStatus ?? 'pending'
  const transcriptStatus = opts.transcriptStatus ?? 'available'
  const transcriptFilePath =
    opts.transcriptFilePath !== undefined ? opts.transcriptFilePath : 'data/transcripts/abc123.txt'

  db.prepare(
    `INSERT OR IGNORE INTO channels (youtube_channel_id, name) VALUES ('UCtest', 'Test Channel')`
  ).run()
  const ch = db
    .prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`)
    .get() as { id: number }

  db.prepare(
    `INSERT OR IGNORE INTO videos
     (youtube_video_id, channel_id, title, has_captions, transcript_status, summary_status, transcript_file_path)
     VALUES (?, ?, 'Test Video', 1, ?, ?, ?)`
  ).run(youtubeVideoId, ch.id, transcriptStatus, summaryStatus, transcriptFilePath)

  return (db.prepare(`SELECT id FROM videos WHERE youtube_video_id = ?`).get(youtubeVideoId) as { id: number }).id
}

describe('GET /api/videos/:id/summaries', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare('DELETE FROM summaries').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('returns 404 when video does not exist', async () => {
    const res = await request(app).get('/api/videos/nonexistent/summaries')
    expect(res.status).toBe(404)
  })

  it('returns status:pending when summary_status is pending', async () => {
    seedVideo(getDb(), { summaryStatus: 'pending' })
    const res = await request(app).get('/api/videos/abc123/summaries')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending')
  })

  it('returns status:failed when summary_status is failed', async () => {
    seedVideo(getDb(), { summaryStatus: 'failed' })
    const res = await request(app).get('/api/videos/abc123/summaries')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('failed')
  })

  it('returns shortSummary and keyTopics when summaries exist', async () => {
    const db = getDb()
    const videoId = seedVideo(db, { summaryStatus: 'available' })
    db.prepare(`INSERT INTO summaries (video_id, type, content) VALUES (?, 'short', ?)`).run(
      videoId,
      'Great video about AI.'
    )
    db.prepare(`INSERT INTO summaries (video_id, type, content) VALUES (?, 'topics', ?)`).run(
      videoId,
      JSON.stringify(['AI', 'machine learning'])
    )

    const res = await request(app).get('/api/videos/abc123/summaries')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('available')
    expect(res.body.shortSummary).toBe('Great video about AI.')
    expect(res.body.keyTopics).toEqual(['AI', 'machine learning'])
  })
})

describe('POST /api/videos/:id/summaries/retry', () => {
  beforeEach(() => {
    mockSummarizeVideo.mockReset()
    mockReadTranscript.mockReset()
    const db = getDb()
    db.prepare('DELETE FROM summaries').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('returns 404 when video does not exist', async () => {
    const res = await request(app).post('/api/videos/nonexistent/summaries/retry')
    expect(res.status).toBe(404)
  })

  it('returns 422 when transcript is not available', async () => {
    seedVideo(getDb(), { transcriptStatus: 'pending', transcriptFilePath: null })
    const res = await request(app).post('/api/videos/abc123/summaries/retry')
    expect(res.status).toBe(422)
  })

  it('returns 422 when transcript_file_path is null', async () => {
    seedVideo(getDb(), { transcriptStatus: 'available', transcriptFilePath: null })
    const res = await request(app).post('/api/videos/abc123/summaries/retry')
    expect(res.status).toBe(422)
  })

  it('summarizes and returns result on success', async () => {
    const db = getDb()
    seedVideo(db, { transcriptStatus: 'available', summaryStatus: 'failed' })

    mockReadTranscript.mockResolvedValueOnce([{ text: 'Transcript text here', start: 0, dur: 5 }])
    mockSummarizeVideo.mockResolvedValueOnce({
      shortSummary: 'A retried summary.',
      keyTopics: ['retry', 'test'],
    })

    const res = await request(app).post('/api/videos/abc123/summaries/retry')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('available')
    expect(res.body.shortSummary).toBe('A retried summary.')
    expect(res.body.keyTopics).toEqual(['retry', 'test'])

    const video = db
      .prepare(`SELECT summary_status FROM videos WHERE youtube_video_id = 'abc123'`)
      .get() as any
    expect(video.summary_status).toBe('available')
  })

  it('passes transcript file content (not chunks) to summarizeVideo', async () => {
    const db = getDb()
    seedVideo(db, { transcriptStatus: 'available', summaryStatus: 'failed' })

    mockReadTranscript.mockResolvedValueOnce([
      { text: 'First sentence.', start: 0, dur: 2 },
      { text: 'Second sentence.', start: 2, dur: 2 },
    ])
    mockSummarizeVideo.mockResolvedValueOnce({ shortSummary: 'ok', keyTopics: [] })

    await request(app).post('/api/videos/abc123/summaries/retry')

    expect(mockSummarizeVideo).toHaveBeenCalledWith(
      expect.anything(),
      'First sentence. Second sentence.'
    )
  })

  it('returns 502 and sets summary_status=failed when summarization throws', async () => {
    const db = getDb()
    seedVideo(db, { transcriptStatus: 'available', summaryStatus: 'pending' })

    mockReadTranscript.mockResolvedValueOnce([{ text: 'Transcript text', start: 0, dur: 3 }])
    mockSummarizeVideo.mockRejectedValueOnce(new Error('API timeout'))

    const res = await request(app).post('/api/videos/abc123/summaries/retry')
    expect(res.status).toBe(502)

    const video = db
      .prepare(`SELECT summary_status FROM videos WHERE youtube_video_id = 'abc123'`)
      .get() as any
    expect(video.summary_status).toBe('failed')
  })
})
