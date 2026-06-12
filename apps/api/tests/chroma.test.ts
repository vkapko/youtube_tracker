import { describe, expect, it, vi } from 'vitest'
import { ChromaService } from '../src/services/chroma'
import type { TranscriptChunk } from '../src/services/chunking'

import type { ChromaClientLike } from '../src/services/chroma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeClient(queryFn?: (...args: any[]) => any, getFn?: (...args: any[]) => any): ChromaClientLike {
  const query = queryFn ?? vi.fn(async () => ({
    ids: [[]], documents: [[]], metadatas: [[]], distances: [[]]
  }))
  const get = getFn ?? vi.fn(async () => ({ ids: [], metadatas: [] }))
  return {
    getOrCreateCollection: vi.fn(async () => ({
      delete: vi.fn(async () => {}),
      upsert: vi.fn(async () => {}),
      query,
      get,
    })),
    deleteCollection: vi.fn(async () => {}),
  } as unknown as ChromaClientLike
}

describe('ChromaService.query()', () => {
  it('calls collection.query with queryTexts, nResults, and no where when no channelIds', async () => {
    const queryResult = {
      ids: [['vid1:0', 'vid2:1']],
      documents: [['text one', 'text two']],
      metadatas: [[
        { videoId: 'vid1', channelId: 'ch1', title: 'Title 1', startSeconds: 5, endSeconds: 10 },
        { videoId: 'vid2', channelId: 'ch2', title: 'Title 2', startSeconds: 20, endSeconds: 30 },
      ]],
      distances: [[0.2, 0.4]],
    }
    const queryFn = vi.fn(async () => queryResult)
    const client = makeClient(queryFn)

    const result = await new ChromaService(client).query({
      queryText: 'what is machine learning',
      nResults: 10,
    })

    expect(queryFn).toHaveBeenCalledWith({
      queryTexts: ['what is machine learning'],
      nResults: 10,
      where: undefined,
    })
    expect(result).toEqual(queryResult)
  })

  it('converts ISO date strings to epoch seconds for $gte/$lte filters', async () => {
    const queryFn = vi.fn(async () => ({
      ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
    }))
    const client = makeClient(queryFn)

    await new ChromaService(client).query({
      queryText: 'test',
      nResults: 5,
      fromDate: '2026-01-01T00:00:00Z',
      toDate: '2026-06-01T00:00:00Z',
    })

    expect(queryFn).toHaveBeenCalledWith({
      queryTexts: ['test'],
      nResults: 5,
      where: {
        $and: [
          { publishedAt: { $gte: 1767225600 } },
          { publishedAt: { $lte: 1780358399 } },
        ],
      },
    })
  })

  it('passes videoIds as a Chroma $in where filter', async () => {
    const queryFn = vi.fn(async () => ({
      ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
    }))
    const client = makeClient(queryFn)

    await new ChromaService(client).query({
      queryText: 'test',
      nResults: 5,
      videoIds: ['vid1', 'vid2'],
    })

    expect(queryFn).toHaveBeenCalledWith({
      queryTexts: ['test'],
      nResults: 5,
      where: { videoId: { $in: ['vid1', 'vid2'] } },
    })
  })

  it('passes channelIds as a Chroma $in where filter', async () => {
    const queryFn = vi.fn(async () => ({
      ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
    }))
    const client = makeClient(queryFn)

    await new ChromaService(client).query({
      queryText: 'test',
      nResults: 5,
      channelIds: ['ch1', 'ch2'],
    })

    expect(queryFn).toHaveBeenCalledWith({
      queryTexts: ['test'],
      nResults: 5,
      where: { channelId: { $in: ['ch1', 'ch2'] } },
    })
  })
})

describe('ChromaService', () => {
  it('upserts raw chunk text with stable ids and video metadata', async () => {
    const remove = vi.fn(async () => ({ deleted: 0 }))
    const upsert = vi.fn(async () => {})
    const client = {
      getOrCreateCollection: vi.fn(async () => ({ delete: remove, upsert, query: vi.fn(), get: vi.fn() })),
      deleteCollection: vi.fn(async () => {}),
    }
    const chunks: TranscriptChunk[] = [{
      chunkIndex: 0,
      text: 'Raw transcript text.',
      startSeconds: 12,
      endSeconds: 18,
      tokenCount: 3,
    }]

    await new ChromaService(client).indexChunks({
      videoId: 'video-1',
      channelId: 'channel-1',
      title: 'Video title',
      channelTitle: 'Channel title',
      publishedAt: '2026-01-01T00:00:00Z',
      transcriptFilePath: 'data/transcripts/channel-1/video-1.txt',
      chunks,
    })

    expect(remove).toHaveBeenCalledWith({ where: { videoId: 'video-1' } })
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0])
    expect(upsert).toHaveBeenCalledWith({
      ids: ['video-1:0'],
      documents: ['Raw transcript text.'],
      metadatas: [{
        videoId: 'video-1',
        channelId: 'channel-1',
        title: 'Video title',
        channelTitle: 'Channel title',
        publishedAt: 1767225600,
        startSeconds: 12,
        endSeconds: 18,
        transcriptFilePath: 'data/transcripts/channel-1/video-1.txt',
      }],
    })
  })

  it('returns true from hasStringPublishedAt when existing records store publishedAt as a string', async () => {
    const client = makeClient(undefined, vi.fn(async () => ({
      ids: ['vid1:0'],
      metadatas: [{ videoId: 'vid1', publishedAt: '2025-01-01T00:00:00Z' }],
    })))

    expect(await new ChromaService(client).hasStringPublishedAt()).toBe(true)
  })

  it('returns false from hasStringPublishedAt when records store publishedAt as an epoch number', async () => {
    const client = makeClient(undefined, vi.fn(async () => ({
      ids: ['vid1:0'],
      metadatas: [{ videoId: 'vid1', publishedAt: 1767225600 }],
    })))

    expect(await new ChromaService(client).hasStringPublishedAt()).toBe(false)
  })

  it('returns true from hasStringPublishedAt when string publishedAt appears in a later page', async () => {
    // Page 1: full page of numeric entries — pagination must continue.
    // Page 2: contains a stale string entry — exhaustive scan catches it.
    const getFn = vi.fn(async ({ offset }: { limit: number; offset: number }) => {
      if (offset === 0) {
        return {
          ids: Array.from({ length: 1000 }, (_, i) => `vid1:${i}`),
          metadatas: Array.from({ length: 1000 }, () => ({ videoId: 'vid1', publishedAt: 1767225600 })),
        }
      }
      return {
        ids: ['vid2:0'],
        metadatas: [{ videoId: 'vid2', publishedAt: '2025-01-01T00:00:00Z' }],
      }
    })
    const client = makeClient(undefined, getFn)

    expect(await new ChromaService(client).hasStringPublishedAt()).toBe(true)
  })

  it('returns false from hasStringPublishedAt when collection is empty', async () => {
    const client = makeClient(undefined, vi.fn(async () => ({ ids: [], metadatas: [] })))

    expect(await new ChromaService(client).hasStringPublishedAt()).toBe(false)
  })

  it('propagates errors from hasStringPublishedAt when Chroma throws', async () => {
    const client = makeClient(undefined, vi.fn(async () => { throw new Error('Chroma unavailable') }))

    await expect(new ChromaService(client).hasStringPublishedAt()).rejects.toThrow('Chroma unavailable')
  })

  it('removes stale documents when a video now has no chunks', async () => {
    const remove = vi.fn(async () => ({ deleted: 2 }))
    const upsert = vi.fn(async () => {})
    const client = {
      getOrCreateCollection: vi.fn(async () => ({ delete: remove, upsert, query: vi.fn(), get: vi.fn() })),
      deleteCollection: vi.fn(async () => {}),
    }

    await new ChromaService(client).indexChunks({
      videoId: 'video-1',
      channelId: 'channel-1',
      title: 'Video title',
      channelTitle: 'Channel title',
      publishedAt: '2026-01-01T00:00:00Z',
      transcriptFilePath: 'data/transcripts/channel-1/video-1.txt',
      chunks: [],
    })

    expect(remove).toHaveBeenCalledWith({ where: { videoId: 'video-1' } })
    expect(upsert).not.toHaveBeenCalled()
  })
})
