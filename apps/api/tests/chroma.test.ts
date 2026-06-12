import { describe, expect, it, vi } from 'vitest'
import { ChromaService } from '../src/services/chroma'
import type { TranscriptChunk } from '../src/services/chunking'

describe('ChromaService', () => {
  it('upserts raw chunk text with stable ids and video metadata', async () => {
    const remove = vi.fn(async () => ({ deleted: 0 }))
    const upsert = vi.fn(async () => {})
    const client = {
      getOrCreateCollection: vi.fn(async () => ({ delete: remove, upsert })),
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
        publishedAt: '2026-01-01T00:00:00Z',
        startSeconds: 12,
        endSeconds: 18,
        transcriptFilePath: 'data/transcripts/channel-1/video-1.txt',
      }],
    })
  })

  it('removes stale documents when a video now has no chunks', async () => {
    const remove = vi.fn(async () => ({ deleted: 2 }))
    const upsert = vi.fn(async () => {})
    const client = {
      getOrCreateCollection: vi.fn(async () => ({ delete: remove, upsert })),
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
