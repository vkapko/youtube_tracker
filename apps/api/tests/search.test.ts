import { describe, it, expect, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { runMigration } from '../src/db/migrate'
import { SearchService } from '../src/services/search'
import type { ChromaQueryResult } from '../src/services/chroma'

function makeDb() {
  const db = new BetterSqlite3(':memory:')
  runMigration(db)
  return db
}

function seedVideo(db: BetterSqlite3.Database, opts: {
  youtubeVideoId: string
  title?: string
  channelName?: string
  youtubeChannelId?: string
  publishedAt?: string
  thumbnailUrl?: string
}) {
  const channelId = opts.youtubeChannelId ?? 'UCdefault'
  db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES (?, ?) ON CONFLICT(youtube_channel_id) DO NOTHING`)
    .run(channelId, opts.channelName ?? 'Default Channel')
  const { id: dbChannelId } = db.prepare(`SELECT id FROM channels WHERE youtube_channel_id = ?`).get(channelId) as { id: number }
  db.prepare(`
    INSERT INTO videos (youtube_video_id, channel_id, title, published_at, thumbnail_url, transcript_status)
    VALUES (?, ?, ?, ?, ?, 'available')
    ON CONFLICT(youtube_video_id) DO NOTHING
  `).run(opts.youtubeVideoId, dbChannelId, opts.title ?? 'Test Video', opts.publishedAt ?? '2025-01-01T00:00:00Z', opts.thumbnailUrl ?? null)
}

function makeChromaResult(chunks: Array<{
  videoId: string
  distance: number
  text: string
  startSeconds?: number
  channelId?: string
}>): ChromaQueryResult {
  return {
    ids: [chunks.map((c, i) => `${c.videoId}:${i}`)],
    documents: [chunks.map(c => c.text)],
    metadatas: [chunks.map(c => ({
      videoId: c.videoId,
      channelId: c.channelId ?? 'UCdefault',
      startSeconds: c.startSeconds ?? 0,
      endSeconds: (c.startSeconds ?? 0) + 10,
    }))],
    distances: [chunks.map(c => c.distance)],
  }
}

function makeChroma(result: ChromaQueryResult) {
  return { query: vi.fn(async () => result) }
}

describe('SearchService.search()', () => {
  it('returns empty array when Chroma returns no results', async () => {
    const db = makeDb()
    const chroma = makeChroma({ ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] })

    const results = await new SearchService(db, chroma as any).search({ query: 'anything' })

    expect(results).toEqual([])
  })

  it('deduplicates chunks to one result per video keeping the best (lowest distance) chunk', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'vid1', title: 'Video One' })
    seedVideo(db, { youtubeVideoId: 'vid2', title: 'Video Two' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'vid1', distance: 0.2, text: 'best chunk', startSeconds: 10 },
      { videoId: 'vid1', distance: 0.4, text: 'worse chunk', startSeconds: 30 },
      { videoId: 'vid2', distance: 0.3, text: 'vid2 chunk', startSeconds: 5 },
    ]))

    const results = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(results).toHaveLength(2)
    expect(results[0].videoId).toBe('vid1')
    expect(results[0].snippet).toBe('best chunk')
    expect(results[0].startSeconds).toBe(10)
    expect(results[1].videoId).toBe('vid2')
  })

  it('enriches results with title, channelName, publishedAt, thumbnailUrl from SQLite', async () => {
    const db = makeDb()
    seedVideo(db, {
      youtubeVideoId: 'vid1',
      title: 'My Video Title',
      channelName: 'Great Channel',
      publishedAt: '2025-06-01T00:00:00Z',
      thumbnailUrl: 'https://img.youtube.com/thumb.jpg',
    })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'vid1', distance: 0.2, text: 'snippet text', startSeconds: 5 },
    ]))

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.title).toBe('My Video Title')
    expect(result.channelName).toBe('Great Channel')
    expect(result.publishedAt).toBe('2025-06-01T00:00:00Z')
    expect(result.thumbnailUrl).toBe('https://img.youtube.com/thumb.jpg')
  })

  it('builds youtubeUrl with timestamp when startSeconds is present', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'abc123' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'abc123', distance: 0.2, text: 'text', startSeconds: 42 },
    ]))

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.youtubeUrl).toBe('https://www.youtube.com/watch?v=abc123&t=42s')
  })

  it('builds youtubeUrl with t=0s for manual-transcript chunks that have no timing data', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'manual1' })

    const chroma = {
      query: vi.fn(async () => ({
        ids: [['manual1:0']],
        documents: [['some text']],
        metadatas: [[{ videoId: 'manual1', channelId: 'UCdefault', startSeconds: 0 }]],
        distances: [[0.2]],
      })),
    }

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.startSeconds).toBe(0)
    expect(result.youtubeUrl).toBe('https://www.youtube.com/watch?v=manual1&t=0s')
  })

  it('sets additionalMatchCount when multiple chunks above threshold match same video', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'vid1' })

    // 3 chunks from vid1, all with distance ≤ 0.5 (similarity ≥ 0.5)
    const chroma = makeChroma(makeChromaResult([
      { videoId: 'vid1', distance: 0.1, text: 'best', startSeconds: 0 },
      { videoId: 'vid1', distance: 0.3, text: 'second', startSeconds: 10 },
      { videoId: 'vid1', distance: 0.45, text: 'third', startSeconds: 20 },
    ]))

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.snippet).toBe('best')
    expect(result.additionalMatchCount).toBe(2)
  })

  it('does not set additionalMatchCount when extra chunks are below threshold', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'vid1' })

    // Best chunk above threshold, second chunk below threshold
    const chroma = makeChroma(makeChromaResult([
      { videoId: 'vid1', distance: 0.2, text: 'best', startSeconds: 0 },
      { videoId: 'vid1', distance: 0.6, text: 'weak', startSeconds: 10 },
    ]))

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.additionalMatchCount).toBeUndefined()
  })

  it('excludes results whose publishedAt is before fromDate', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'old', publishedAt: '2024-01-01T00:00:00Z' })
    seedVideo(db, { youtubeVideoId: 'new', publishedAt: '2025-06-01T00:00:00Z' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'old', distance: 0.1, text: 'old text' },
      { videoId: 'new', distance: 0.2, text: 'new text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({
      query: 'test',
      fromDate: '2025-01-01T00:00:00Z',
    })

    expect(chroma.query).toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2025-01-01T00:00:00Z' }))
    expect(results.map(r => r.videoId)).toEqual(['new'])
  })

  it('excludes results whose publishedAt is after toDate', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'old', publishedAt: '2024-01-01T00:00:00Z' })
    seedVideo(db, { youtubeVideoId: 'new', publishedAt: '2025-06-01T00:00:00Z' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'old', distance: 0.1, text: 'old text' },
      { videoId: 'new', distance: 0.2, text: 'new text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({
      query: 'test',
      toDate: '2024-12-31T23:59:59Z',
    })

    expect(chroma.query).toHaveBeenCalledWith(expect.objectContaining({ toDate: '2024-12-31T23:59:59Z' }))
    expect(results.map(r => r.videoId)).toEqual(['old'])
  })

  it('includes videos published on the toDate day when toDate is YYYY-MM-DD', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'same-day', publishedAt: '2024-12-31T18:00:00Z' })
    seedVideo(db, { youtubeVideoId: 'next-day', publishedAt: '2025-01-01T00:00:00Z' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'same-day', distance: 0.1, text: 'same day text' },
      { videoId: 'next-day', distance: 0.2, text: 'next day text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({
      query: 'test',
      toDate: '2024-12-31',
    })

    expect(results.map(r => r.videoId)).toEqual(['same-day'])
  })

  it('retries with a larger window when one video dominates the initial chunk fetch', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'dominant' })
    seedVideo(db, { youtubeVideoId: 'buried' })

    // topK=2 → initial nResults = 2*5 = 10
    // First broad call: all 10 slots taken by 'dominant' (ids.length === nResults → retry)
    const firstPass = makeChromaResult(
      Array.from({ length: 10 }, (_, i) => ({ videoId: 'dominant', distance: 0.1, text: `chunk ${i}`, startSeconds: i * 10 }))
    )
    // Second broad call with nResults=20: dominant + buried visible
    const secondPass = makeChromaResult([
      ...Array.from({ length: 10 }, (_, i) => ({ videoId: 'dominant', distance: 0.1, text: `chunk ${i}`, startSeconds: i * 10 })),
      { videoId: 'buried', distance: 0.3, text: 'buried chunk', startSeconds: 0 },
    ])

    const chroma = { query: vi.fn()
      .mockResolvedValueOnce(firstPass)   // broad loop pass 1
      .mockResolvedValueOnce(secondPass)  // broad loop pass 2
      .mockResolvedValue(makeChromaResult([]))  // per-video second-pass queries
    }

    const results = await new SearchService(db, chroma as any).search({ query: 'test', topK: 2 })

    expect(results.map(r => r.videoId)).toContain('buried')
    // First two calls are the broad loop (no videoIds filter), third+ are per-video
    expect(chroma.query).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ videoIds: expect.anything() }))
    expect(chroma.query).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ videoIds: expect.anything() }))
  })

  it('accurately counts additionalMatchCount even when extra chunks fall outside the first-pass window', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'vid1' })

    const firstPassResult = makeChromaResult([
      { videoId: 'vid1', distance: 0.1, text: 'best chunk', startSeconds: 0 },
      { videoId: 'vid1', distance: 0.3, text: 'second chunk', startSeconds: 10 },
    ])
    const secondPassResult = makeChromaResult([
      { videoId: 'vid1', distance: 0.1, text: 'best chunk', startSeconds: 0 },
      { videoId: 'vid1', distance: 0.3, text: 'second chunk', startSeconds: 10 },
      { videoId: 'vid1', distance: 0.4, text: 'third chunk', startSeconds: 20 },
      { videoId: 'vid1', distance: 0.45, text: 'fourth chunk', startSeconds: 30 },
      { videoId: 'vid1', distance: 0.48, text: 'fifth chunk', startSeconds: 40 },
    ])

    const chroma = { query: vi.fn()
      .mockResolvedValueOnce(firstPassResult)
      .mockResolvedValueOnce(secondPassResult)
    }

    const [result] = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(result.additionalMatchCount).toBe(4)
    expect(chroma.query).toHaveBeenCalledTimes(2)
    expect(chroma.query).toHaveBeenNthCalledWith(2, expect.objectContaining({ videoIds: ['vid1'] }))
  })

  it('boosts score by 0.15 when query appears in video title (case-insensitive)', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'match', title: 'A Guide To Machine Learning Basics' })
    seedVideo(db, { youtubeVideoId: 'nomatch', title: 'Cooking Tutorial' })

    // Same distance for both, so reranking decides order
    const chroma = makeChroma(makeChromaResult([
      { videoId: 'match', distance: 0.3, text: 'ml text' },
      { videoId: 'nomatch', distance: 0.3, text: 'cooking text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({ query: 'machine learning' })

    expect(results[0].videoId).toBe('match')
    expect(results[0].score).toBeCloseTo(0.7 + 0.15, 5)
    expect(results[1].score).toBeCloseTo(0.7, 5)
  })

  it('boosts score by 0.05 when video was published within 90 days of today', async () => {
    const db = makeDb()
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const old = '2020-01-01T00:00:00Z'

    seedVideo(db, { youtubeVideoId: 'recent', title: 'Cooking Basics', publishedAt: recent })
    seedVideo(db, { youtubeVideoId: 'old', title: 'Cooking Basics', publishedAt: old })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'recent', distance: 0.3, text: 'recent text' },
      { videoId: 'old', distance: 0.3, text: 'old text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({ query: 'test' })

    const recentResult = results.find(r => r.videoId === 'recent')!
    const oldResult = results.find(r => r.videoId === 'old')!

    expect(recentResult.score).toBeCloseTo(0.7 + 0.05, 5)
    expect(oldResult.score).toBeCloseTo(0.7, 5)
  })

  it('includes videos published on the fromDate day when fromDate is YYYY-MM-DD', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'same-day', publishedAt: '2025-01-01T12:00:00Z' })
    seedVideo(db, { youtubeVideoId: 'prev-day', publishedAt: '2024-12-31T23:59:59Z' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'same-day', distance: 0.1, text: 'same day text' },
      { videoId: 'prev-day', distance: 0.2, text: 'prev day text' },
    ]))

    const results = await new SearchService(db, chroma as any).search({
      query: 'test',
      fromDate: '2025-01-01',
    })

    expect(results.map(r => r.videoId)).toEqual(['same-day'])
  })

  it('returns empty results when date filtering exhausts all fetched candidates', async () => {
    const db = makeDb()
    seedVideo(db, { youtubeVideoId: 'old1', publishedAt: '2020-01-01T00:00:00Z' })
    seedVideo(db, { youtubeVideoId: 'old2', publishedAt: '2020-06-01T00:00:00Z' })

    const chroma = makeChroma(makeChromaResult([
      { videoId: 'old1', distance: 0.1, text: 'old text 1' },
      { videoId: 'old2', distance: 0.2, text: 'old text 2' },
    ]))

    const results = await new SearchService(db, chroma as any).search({
      query: 'test',
      fromDate: '2025-01-01',
    })

    expect(results).toEqual([])
  })

  it('limits results to topK (default 10)', async () => {
    const db = makeDb()
    const chunks = Array.from({ length: 15 }, (_, i) => {
      const videoId = `vid${i}`
      seedVideo(db, { youtubeVideoId: videoId })
      return { videoId, distance: 0.1 + i * 0.01, text: `text ${i}` }
    })

    const chroma = makeChroma(makeChromaResult(chunks))

    const results = await new SearchService(db, chroma as any).search({ query: 'test' })

    expect(results).toHaveLength(10)
  })

  it('respects a custom topK', async () => {
    const db = makeDb()
    const chunks = Array.from({ length: 5 }, (_, i) => {
      const videoId = `vid${i}`
      seedVideo(db, { youtubeVideoId: videoId })
      return { videoId, distance: 0.2, text: `text ${i}` }
    })

    const chroma = makeChroma(makeChromaResult(chunks))

    const results = await new SearchService(db, chroma as any).search({ query: 'test', topK: 3 })

    expect(results).toHaveLength(3)
  })
})
