import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import BetterSqlite3 from 'better-sqlite3'
import { runMigration } from '../src/db/migrate'

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: vi.fn() },
}))

vi.mock('../src/services/chroma', () => ({
  ChromaService: class {
    async indexChunks() {}
    async resetCollection() {}
  },
}))

let tmpDir: string

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

vi.mock('../src/services/transcriptFile', async () => {
  return {
    saveTranscript: vi.fn(async () => path.join(tmpDir, 'transcripts', 'UCtest', 'vid1.txt')),
    readTranscript: vi.fn(async () => []),
  }
})

import app from '../src/app'
import { getDb } from '../src/db/database'
import * as transcriptFileMod from '../src/services/transcriptFile'
import type { ParsedSegment } from '../src/services/transcriptFile'

function seedVideo(youtubeVideoId: string, transcript_status = 'pending') {
  const db = getDb()
  const channel = db.prepare(
    `INSERT INTO channels (youtube_channel_id, name) VALUES ('UCtest', 'Test Channel') ON CONFLICT DO NOTHING`
  ).run()
  const channelId = (db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = 'UCtest'`).get() as { id: number }).id
  db.prepare(`
    INSERT INTO videos (youtube_video_id, channel_id, title, has_captions, transcript_status)
    VALUES (?, ?, 'Test Video', 1, ?)
    ON CONFLICT(youtube_video_id) DO UPDATE SET transcript_status = excluded.transcript_status
  `).run(youtubeVideoId, channelId, transcript_status)
}

describe('GET /api/videos/:youtubeVideoId/transcript', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-route-test-'))
    vi.mocked(transcriptFileMod.readTranscript).mockClear()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns 404 when the video does not exist', async () => {
    const res = await request(app).get('/api/videos/nonexistent/transcript')
    expect(res.status).toBe(404)
  })

  it('returns 404 when transcript_status is not available', async () => {
    seedVideo('vid2', 'pending')
    const res = await request(app).get('/api/videos/vid2/transcript')
    expect(res.status).toBe(404)
    expect(transcriptFileMod.readTranscript).not.toHaveBeenCalled()
  })

  it('returns segments when transcript is available', async () => {
    seedVideo('vid3', 'available')
    const db = getDb()
    db.prepare(`UPDATE videos SET transcript_file_path = 'data/transcripts/UCtest/vid3.txt' WHERE youtube_video_id = 'vid3'`).run()

    const mockSegments: ParsedSegment[] = [
      { startSeconds: 0, text: 'Hello' },
      { startSeconds: 5, text: 'World' },
    ]
    vi.mocked(transcriptFileMod.readTranscript).mockResolvedValueOnce(mockSegments)

    const res = await request(app).get('/api/videos/vid3/transcript')
    expect(res.status).toBe(200)
    expect(res.body.segments).toEqual(mockSegments)
    expect(transcriptFileMod.readTranscript).toHaveBeenCalledWith('data/transcripts/UCtest/vid3.txt')
  })

  it('returns 500 when readTranscript throws', async () => {
    seedVideo('vid4', 'available')
    const db = getDb()
    db.prepare(`UPDATE videos SET transcript_file_path = 'data/transcripts/UCtest/vid4.txt' WHERE youtube_video_id = 'vid4'`).run()

    vi.mocked(transcriptFileMod.readTranscript).mockRejectedValueOnce(new Error('disk error'))

    const res = await request(app).get('/api/videos/vid4/transcript')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/videos/:youtubeVideoId/transcript', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-route-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    vi.mocked(transcriptFileMod.saveTranscript).mockClear()
  })

  it('returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/videos/vid1/transcript')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 when the video does not exist', async () => {
    const res = await request(app)
      .post('/api/videos/nonexistent/transcript')
      .send({ text: 'Some transcript' })
    expect(res.status).toBe(404)
  })

  it('saves the transcript and marks the video available', async () => {
    seedVideo('vid1', 'failed')
    const res = await request(app)
      .post('/api/videos/vid1/transcript')
      .send({ text: 'My manual transcript content.' })
    expect(res.status).toBe(200)
    expect(res.body.transcript_status).toBe('available')
    expect(res.body.transcript_file_path).toBeTruthy()
    expect(transcriptFileMod.saveTranscript).toHaveBeenCalledOnce()

    const db = getDb()
    const row = db.prepare(`SELECT transcript_status, transcript_file_path FROM videos WHERE youtube_video_id = 'vid1'`).get() as any
    expect(row.transcript_status).toBe('available')
    expect(row.transcript_file_path).toBeTruthy()
    const chunk = db.prepare(`
      SELECT tc.chroma_document_id
      FROM transcript_chunks tc
      JOIN videos v ON v.id = tc.video_id
      WHERE v.youtube_video_id = 'vid1'
    `).get() as { chroma_document_id: string }
    expect(chunk.chroma_document_id).toBe('vid1:0')
  })
})
