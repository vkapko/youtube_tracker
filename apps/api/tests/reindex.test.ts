import { describe, expect, it, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { runMigration } from '../src/db/migrate'
import { reindexAvailableTranscripts, migratePublishedAtIfNeeded } from '../src/services/reindex'

describe('reindexAvailableTranscripts', () => {
  it('resets Chroma and indexes persisted chunks for available videos only', async () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)
    const channel = db.prepare(`
      INSERT INTO channels (youtube_channel_id, name) VALUES ('channel-1', 'Channel')
      RETURNING id
    `).get() as { id: number }
    const available = db.prepare(`
      INSERT INTO videos
        (youtube_video_id, channel_id, title, published_at, transcript_status, transcript_file_path)
      VALUES ('available-video', ?, 'Available', '2026-01-01', 'available', 'available.txt')
      RETURNING id
    `).get(channel.id) as { id: number }
    const unavailable = db.prepare(`
      INSERT INTO videos (youtube_video_id, channel_id, title, transcript_status)
      VALUES ('unavailable-video', ?, 'Unavailable', 'unavailable')
      RETURNING id
    `).get(channel.id) as { id: number }
    const insertChunk = db.prepare(`
      INSERT INTO transcript_chunks
        (video_id, chunk_index, text, start_timestamp_seconds, end_timestamp_seconds, token_count, chroma_document_id)
      VALUES (?, 0, ?, 3, 8, 2, ?)
    `)
    insertChunk.run(available.id, 'Available text.', 'available-video:0')
    insertChunk.run(unavailable.id, 'Unavailable text.', 'unavailable-video:0')

    const chroma = {
      resetCollection: vi.fn(async () => {}),
      indexChunks: vi.fn(async () => {}),
    }
    await reindexAvailableTranscripts(db, chroma)

    expect(chroma.resetCollection).toHaveBeenCalledOnce()
    expect(chroma.indexChunks).toHaveBeenCalledOnce()
    expect(chroma.indexChunks).toHaveBeenCalledWith(expect.objectContaining({
      videoId: 'available-video',
      chunks: [expect.objectContaining({ text: 'Available text.' })],
    }))
    db.close()
  })
})

describe('migratePublishedAtIfNeeded', () => {
  it('runs reindex and returns true when hasStringPublishedAt is true', async () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)

    const chroma = {
      resetCollection: vi.fn(async () => {}),
      indexChunks: vi.fn(async () => {}),
      hasStringPublishedAt: vi.fn(async () => true),
    }

    const result = await migratePublishedAtIfNeeded(db, chroma)

    expect(result).toBe(true)
    expect(chroma.resetCollection).toHaveBeenCalledOnce()
    db.close()
  })

  it('skips reindex and returns false when hasStringPublishedAt is false', async () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)

    const chroma = {
      resetCollection: vi.fn(async () => {}),
      indexChunks: vi.fn(async () => {}),
      hasStringPublishedAt: vi.fn(async () => false),
    }

    const result = await migratePublishedAtIfNeeded(db, chroma)

    expect(result).toBe(false)
    expect(chroma.resetCollection).not.toHaveBeenCalled()
    db.close()
  })
})
