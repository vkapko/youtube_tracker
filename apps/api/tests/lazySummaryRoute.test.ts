import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

const mockGenerateDetailedSummary = vi.hoisted(() => vi.fn())
const mockGenerateActionItems = vi.hoisted(() => vi.fn())
const mockGenerateTechnicalTerms = vi.hoisted(() => vi.fn())
const mockGenerateNotableQuotes = vi.hoisted(() => vi.fn())

vi.mock('../src/services/claude.service', () => ({
  ClaudeService: class {
    generateDetailedSummary = mockGenerateDetailedSummary
    generateActionItems = mockGenerateActionItems
    generateTechnicalTerms = mockGenerateTechnicalTerms
    generateNotableQuotes = mockGenerateNotableQuotes
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
    transcriptStatus?: string
    transcriptFilePath?: string | null
  } = {}
) {
  const youtubeVideoId = opts.youtubeVideoId ?? 'vid123'
  const transcriptStatus = opts.transcriptStatus ?? 'available'
  const transcriptFilePath =
    opts.transcriptFilePath !== undefined ? opts.transcriptFilePath : 'data/transcripts/vid123.txt'

  db.prepare(
    `INSERT OR IGNORE INTO channels (youtube_channel_id, name) VALUES ('UCtest', 'Test Channel')`
  ).run()
  const ch = db
    .prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`)
    .get() as { id: number }

  db.prepare(
    `INSERT OR IGNORE INTO videos
     (youtube_video_id, channel_id, title, has_captions, transcript_status, summary_status, transcript_file_path)
     VALUES (?, ?, 'Test Video', 1, ?, 'available', ?)`
  ).run(youtubeVideoId, ch.id, transcriptStatus, transcriptFilePath)

  return (db.prepare(`SELECT id FROM videos WHERE youtube_video_id = ?`).get(youtubeVideoId) as { id: number }).id
}

describe('GET /api/videos/:id/summary/:type', () => {
  beforeEach(() => {
    mockGenerateDetailedSummary.mockReset()
    mockGenerateActionItems.mockReset()
    mockGenerateTechnicalTerms.mockReset()
    mockGenerateNotableQuotes.mockReset()
    mockReadTranscript.mockReset()
    const db = getDb()
    db.prepare('DELETE FROM summaries').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('returns 400 for an unknown summary type', async () => {
    const res = await request(app).get('/api/videos/vid123/summary/unknown_type')
    expect(res.status).toBe(400)
  })

  it('returns 404 when video does not exist', async () => {
    const res = await request(app).get('/api/videos/nonexistent/summary/detailed_summary')
    expect(res.status).toBe(404)
  })

  it('returns cached detailed_summary when it exists in the DB', async () => {
    const db = getDb()
    const videoId = seedVideo(db)
    db.prepare(`INSERT INTO summaries (video_id, type, content) VALUES (?, 'detailed_summary', ?)`).run(
      videoId,
      'Cached detailed summary text.'
    )

    const res = await request(app).get('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('detailed_summary')
    expect(res.body.content).toBe('Cached detailed summary text.')
    expect(mockGenerateDetailedSummary).not.toHaveBeenCalled()
  })

  it('returns cached action_items (parsed from JSON) when they exist', async () => {
    const db = getDb()
    const videoId = seedVideo(db)
    db.prepare(`INSERT INTO summaries (video_id, type, content) VALUES (?, 'action_items', ?)`).run(
      videoId,
      JSON.stringify(['Do this', 'Then that'])
    )

    const res = await request(app).get('/api/videos/vid123/summary/action_items')
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('action_items')
    expect(res.body.content).toEqual(['Do this', 'Then that'])
    expect(mockGenerateActionItems).not.toHaveBeenCalled()
  })

  it('generates and caches detailed_summary when not in DB', async () => {
    const db = getDb()
    seedVideo(db)
    mockReadTranscript.mockResolvedValueOnce([{ text: 'Transcript text.', startSeconds: 0 }])
    mockGenerateDetailedSummary.mockResolvedValueOnce('Freshly generated detailed summary.')

    const res = await request(app).get('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('detailed_summary')
    expect(res.body.content).toBe('Freshly generated detailed summary.')

    const cached = db
      .prepare(`SELECT content FROM summaries WHERE video_id = (SELECT id FROM videos WHERE youtube_video_id = 'vid123') AND type = 'detailed_summary'`)
      .get() as { content: string } | undefined
    expect(cached?.content).toBe('Freshly generated detailed summary.')
  })

  it('generates and caches action_items (stored as JSON) when not in DB', async () => {
    const db = getDb()
    seedVideo(db)
    mockReadTranscript.mockResolvedValueOnce([{ text: 'Transcript text.', startSeconds: 0 }])
    mockGenerateActionItems.mockResolvedValueOnce(['Step 1', 'Step 2'])

    const res = await request(app).get('/api/videos/vid123/summary/action_items')
    expect(res.status).toBe(200)
    expect(res.body.content).toEqual(['Step 1', 'Step 2'])

    const cached = db
      .prepare(`SELECT content FROM summaries WHERE video_id = (SELECT id FROM videos WHERE youtube_video_id = 'vid123') AND type = 'action_items'`)
      .get() as { content: string } | undefined
    expect(JSON.parse(cached!.content)).toEqual(['Step 1', 'Step 2'])
  })

  it('returns 422 when transcript is not available and no cache exists', async () => {
    seedVideo(getDb(), { transcriptStatus: 'pending', transcriptFilePath: null })
    const res = await request(app).get('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(422)
  })
})

describe('POST /api/videos/:id/summary/:type', () => {
  beforeEach(() => {
    mockGenerateDetailedSummary.mockReset()
    mockGenerateActionItems.mockReset()
    mockReadTranscript.mockReset()
    const db = getDb()
    db.prepare('DELETE FROM summaries').run()
    db.prepare('DELETE FROM videos').run()
    db.prepare('DELETE FROM channels').run()
  })

  it('returns 400 for an unknown summary type', async () => {
    const res = await request(app).post('/api/videos/vid123/summary/unknown_type')
    expect(res.status).toBe(400)
  })

  it('returns 404 when video does not exist', async () => {
    const res = await request(app).post('/api/videos/nonexistent/summary/detailed_summary')
    expect(res.status).toBe(404)
  })

  it('returns 422 when transcript is not available', async () => {
    seedVideo(getDb(), { transcriptStatus: 'pending', transcriptFilePath: null })
    const res = await request(app).post('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(422)
  })

  it('regenerates and replaces an existing DB record', async () => {
    const db = getDb()
    const videoId = seedVideo(db)
    db.prepare(`INSERT INTO summaries (video_id, type, content) VALUES (?, 'detailed_summary', ?)`).run(
      videoId,
      'Old cached summary.'
    )
    mockReadTranscript.mockResolvedValueOnce([{ text: 'Fresh transcript.', startSeconds: 0 }])
    mockGenerateDetailedSummary.mockResolvedValueOnce('New regenerated summary.')

    const res = await request(app).post('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('New regenerated summary.')
    expect(mockGenerateDetailedSummary).toHaveBeenCalledTimes(1)

    const stored = db
      .prepare(`SELECT content FROM summaries WHERE video_id = ? AND type = 'detailed_summary'`)
      .get(videoId) as { content: string }
    expect(stored.content).toBe('New regenerated summary.')
  })

  it('returns 502 when generation throws', async () => {
    seedVideo(getDb())
    mockReadTranscript.mockResolvedValueOnce([{ text: 'text', startSeconds: 0 }])
    mockGenerateDetailedSummary.mockRejectedValueOnce(new Error('API error'))

    const res = await request(app).post('/api/videos/vid123/summary/detailed_summary')
    expect(res.status).toBe(502)
  })
})
