import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

const mockSearch = vi.hoisted(() => vi.fn(async () => [] as any[]))

vi.mock('../src/services/search', () => ({
  SearchService: class {
    search = mockSearch
  },
}))

import app from '../src/app'
import type { SearchResult } from '../src/services/search'

const mockResult: SearchResult = {
  videoId: 'abc123',
  title: 'Test Video',
  channelName: 'Test Channel',
  publishedAt: '2025-01-01T00:00:00Z',
  thumbnailUrl: 'https://img.youtube.com/thumb.jpg',
  snippet: 'This is a matching transcript chunk.',
  startSeconds: 42,
  youtubeUrl: 'https://www.youtube.com/watch?v=abc123&t=42s',
  score: 0.85,
}

describe('POST /api/search', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    mockSearch.mockResolvedValue([])
  })

  it('returns 400 when query is missing', async () => {
    const res = await request(app).post('/api/search').send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 when query is an empty string', async () => {
    const res = await request(app).post('/api/search').send({ query: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns results from SearchService', async () => {
    mockSearch.mockResolvedValueOnce([mockResult])

    const res = await request(app).post('/api/search').send({ query: 'machine learning' })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].videoId).toBe('abc123')
    expect(res.body.results[0].snippet).toBe('This is a matching transcript chunk.')
    expect(res.body.results[0].youtubeUrl).toBe('https://www.youtube.com/watch?v=abc123&t=42s')
  })

  it('passes channelIds, fromDate, toDate, topK to SearchService', async () => {
    await request(app).post('/api/search').send({
      query: 'deep learning',
      channelIds: ['UCchannel1', 'UCchannel2'],
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
      topK: 5,
    })

    expect(mockSearch).toHaveBeenCalledWith({
      query: 'deep learning',
      channelIds: ['UCchannel1', 'UCchannel2'],
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
      topK: 5,
    })
  })

  it('returns empty results array when SearchService returns nothing', async () => {
    const res = await request(app).post('/api/search').send({ query: 'obscure topic' })
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('returns 503 when SearchService throws (e.g. Chroma unavailable)', async () => {
    mockSearch.mockRejectedValueOnce(new Error('Failed to connect to chromadb'))

    const res = await request(app).post('/api/search').send({ query: 'anything' })

    expect(res.status).toBe(503)
    expect(res.body.error).toContain('chromadb')
  })

  describe('topK validation', () => {
    it('returns 400 for topK = 0', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', topK: 0 })
      expect(res.status).toBe(400)
    })

    it('returns 400 for negative topK', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', topK: -1 })
      expect(res.status).toBe(400)
    })

    it('returns 400 for non-integer topK', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', topK: 2.5 })
      expect(res.status).toBe(400)
    })

    it('returns 400 for topK exceeding maximum (50)', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', topK: 51 })
      expect(res.status).toBe(400)
    })

    it('accepts topK at the maximum (50)', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', topK: 50 })
      expect(res.status).toBe(200)
    })
  })

  describe('channelIds validation', () => {
    it('returns 400 for non-array channelIds', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', channelIds: 'UCchannel1' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for empty channelIds array', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', channelIds: [] })
      expect(res.status).toBe(400)
    })

    it('returns 400 for channelIds containing non-strings', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', channelIds: [123, 'UCchannel1'] })
      expect(res.status).toBe(400)
    })

    it('returns 400 for channelIds containing empty strings', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', channelIds: [''] })
      expect(res.status).toBe(400)
    })
  })

  describe('date validation', () => {
    it('returns 400 for invalid fromDate', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', fromDate: 'not-a-date' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for nonexistent fromDate (2025-02-30)', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', fromDate: '2025-02-30' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for nonexistent toDate (2025-13-01)', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', toDate: '2025-13-01' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid toDate', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', toDate: '2025/01/01' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when fromDate is after toDate', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', fromDate: '2025-12-31', toDate: '2025-01-01' })
      expect(res.status).toBe(400)
    })

    it('accepts equal fromDate and toDate', async () => {
      const res = await request(app).post('/api/search').send({ query: 'test', fromDate: '2025-06-01', toDate: '2025-06-01' })
      expect(res.status).toBe(200)
    })
  })
})
