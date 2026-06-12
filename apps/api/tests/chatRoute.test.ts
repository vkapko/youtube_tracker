import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../src/db/database', async () => {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { runMigration } = await import('../src/db/migrate')
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return { getDb: () => db }
})

const mockServiceStream = vi.hoisted(() => vi.fn())

vi.mock('../src/services/chat.service', () => ({
  ChatService: class {
    stream = mockServiceStream
  },
}))

import app from '../src/app'
import type { ChatSource } from '../src/services/chat.service'

function parseSse(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter(Boolean)
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)))
}

function sseRequest(question: unknown, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/chat')
    .send({ question, ...extra })
    .buffer(true)
    .parse((res, callback) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => callback(null, data))
    })
}

const mockSource: ChatSource = {
  videoId: 'vid1',
  title: 'Test Video',
  timestamp: 60,
  reason: 'excerpt about the topic',
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    mockServiceStream.mockReset()
  })

  describe('input validation', () => {
    it('returns 400 when question is missing', async () => {
      const res = await request(app).post('/api/chat').send({})
      expect(res.status).toBe(400)
    })

    it('returns 400 for blank question', async () => {
      const res = await request(app).post('/api/chat').send({ question: '   ' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for empty channelIds array', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', channelIds: [] })
      expect(res.status).toBe(400)
    })

    it('returns 400 for non-array channelIds', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', channelIds: 'UCfoo' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for channelIds containing non-strings', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', channelIds: [123] })
      expect(res.status).toBe(400)
    })

    it('returns 400 for topK = 0', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', topK: 0 })
      expect(res.status).toBe(400)
    })

    it('returns 400 for non-integer topK', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', topK: 2.5 })
      expect(res.status).toBe(400)
    })

    it('returns 400 for topK exceeding 20', async () => {
      const res = await request(app).post('/api/chat').send({ question: 'test?', topK: 21 })
      expect(res.status).toBe(400)
    })
  })

  describe('SSE streaming', () => {
    it('responds with text/event-stream content-type', async () => {
      mockServiceStream.mockImplementationOnce(async function* () {
        yield { type: 'done', sources: [] }
      })

      const res = await sseRequest('What is ML?')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')
    })

    it('streams token and done events with sources', async () => {
      mockServiceStream.mockImplementationOnce(async function* () {
        yield { type: 'token', text: 'Hello ' }
        yield { type: 'token', text: 'world' }
        yield { type: 'done', sources: [mockSource] }
      })

      const res = await sseRequest('What is ML?')

      const events = parseSse(res.body as string)
      expect(events).toContainEqual({ type: 'token', text: 'Hello ' })
      expect(events).toContainEqual({ type: 'token', text: 'world' })
      expect(events).toContainEqual({ type: 'done', sources: [mockSource] })
    })

    it('passes question, channelIds, topK to ChatService', async () => {
      mockServiceStream.mockImplementationOnce(async function* () {
        yield { type: 'done', sources: [] }
      })

      await sseRequest('What is ML?', { channelIds: ['UCabc'], topK: 3 })

      expect(mockServiceStream).toHaveBeenCalledWith({
        question: 'What is ML?',
        channelIds: ['UCabc'],
        topK: 3,
      })
    })

    it('trims whitespace from question before passing to service', async () => {
      mockServiceStream.mockImplementationOnce(async function* () {
        yield { type: 'done', sources: [] }
      })

      await sseRequest('  What is ML?  ')

      expect(mockServiceStream).toHaveBeenCalledWith(
        expect.objectContaining({ question: 'What is ML?' })
      )
    })

    it('writes an error SSE event when service throws', async () => {
      mockServiceStream.mockImplementationOnce(async function* (): AsyncGenerator<never> {
        throw new Error('Chroma unavailable')
      })

      const res = await sseRequest('test?')

      const events = parseSse(res.body as string) as Array<{ type: string; message?: string }>
      const errorEvent = events.find(e => e.type === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent!.message).toContain('Chroma unavailable')
    })
  })
})
