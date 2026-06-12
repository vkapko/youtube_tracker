import { describe, expect, it, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { runMigration } from '../src/db/migrate'
import { TranscriptIndexer } from '../src/services/transcriptIndexing'
import { getChunksForVideo } from '../src/db/transcriptChunks'
import type { TranscriptResult } from '../src/services/transcript'

describe('TranscriptIndexer', () => {
  it('stores chunks with stable Chroma ids and indexes them', async () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('channel-1', 'Channel')`).run()
    const channel = db.prepare(`SELECT id FROM channels`).get() as { id: number }
    db.prepare(`
      INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status)
      VALUES ('video-1', ?, 'Video', 'available')
    `).run(channel.id)
    const video = db.prepare(`SELECT id FROM videos`).get() as { id: number }
    const indexChunks = vi.fn(async () => {})
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'extractor',
      segments: [{ startSeconds: 7, text: 'Stored sentence.' }],
      plainText: 'Stored sentence.',
    }

    const chunks = await new TranscriptIndexer(db, { indexChunks }).indexTranscript({
      videoDbId: video.id,
      videoId: 'video-1',
      channelId: 'channel-1',
      title: 'Video',
      channelTitle: 'Channel',
      publishedAt: '2026-01-01T00:00:00Z',
      transcriptFilePath: 'data/transcripts/channel-1/video-1.txt',
      transcript,
    })

    expect(getChunksForVideo(db, video.id)).toEqual([{
      chunkIndex: 0,
      text: 'Stored sentence.',
      startSeconds: 7,
      endSeconds: 7,
      tokenCount: 3,
      chromaDocumentId: 'video-1:0',
    }])
    expect(indexChunks).toHaveBeenCalledWith(expect.objectContaining({ chunks }))
    db.close()
  })
})
