import type Database from 'better-sqlite3'
import type { TranscriptChunk } from '../services/chunking'

export interface StoredTranscriptChunk extends TranscriptChunk {
  chromaDocumentId: string
}

export interface AvailableTranscriptChunkBatch {
  videoId: string
  channelId: string
  title: string
  channelTitle: string
  publishedAt: string
  transcriptFilePath: string
  chunks: TranscriptChunk[]
}

export function replaceTranscriptChunks(
  db: Database.Database,
  videoDbId: number,
  youtubeVideoId: string,
  chunks: TranscriptChunk[],
): void {
  const insert = db.prepare(`
    INSERT INTO transcript_chunks
      (video_id, chunk_index, text, start_timestamp_seconds, end_timestamp_seconds, token_count, chroma_document_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    db.prepare('DELETE FROM transcript_chunks WHERE video_id = ?').run(videoDbId)
    for (const chunk of chunks) {
      insert.run(
        videoDbId,
        chunk.chunkIndex,
        chunk.text,
        chunk.startSeconds ?? null,
        chunk.endSeconds ?? null,
        chunk.tokenCount,
        `${youtubeVideoId}:${chunk.chunkIndex}`,
      )
    }
  })()
}

export function getChunksForVideo(
  db: Database.Database,
  videoDbId: number,
): StoredTranscriptChunk[] {
  const rows = db.prepare(`
    SELECT chunk_index, text, start_timestamp_seconds, end_timestamp_seconds,
           token_count, chroma_document_id
    FROM transcript_chunks
    WHERE video_id = ?
    ORDER BY chunk_index
  `).all(videoDbId) as Array<{
    chunk_index: number
    text: string
    start_timestamp_seconds: number | null
    end_timestamp_seconds: number | null
    token_count: number
    chroma_document_id: string
  }>

  return rows.map(row => ({
    chunkIndex: row.chunk_index,
    text: row.text,
    startSeconds: row.start_timestamp_seconds ?? undefined,
    endSeconds: row.end_timestamp_seconds ?? undefined,
    tokenCount: row.token_count,
    chromaDocumentId: row.chroma_document_id,
  }))
}

export function getAvailableTranscriptChunkBatches(
  db: Database.Database,
): AvailableTranscriptChunkBatch[] {
  const rows = db.prepare(`
    SELECT v.youtube_video_id, v.title, v.published_at, v.transcript_file_path,
           c.youtube_channel_id, c.name AS channel_title,
           tc.chunk_index, tc.text, tc.start_timestamp_seconds,
           tc.end_timestamp_seconds, tc.token_count
    FROM transcript_chunks tc
    JOIN videos v ON v.id = tc.video_id
    JOIN channels c ON c.id = v.channel_id
    WHERE v.transcript_status = 'available'
    ORDER BY v.id, tc.chunk_index
  `).all() as Array<{
    youtube_video_id: string
    title: string
    published_at: string | null
    transcript_file_path: string | null
    youtube_channel_id: string
    channel_title: string
    chunk_index: number
    text: string
    start_timestamp_seconds: number | null
    end_timestamp_seconds: number | null
    token_count: number
  }>

  const batches = new Map<string, AvailableTranscriptChunkBatch>()
  for (const row of rows) {
    let batch = batches.get(row.youtube_video_id)
    if (!batch) {
      batch = {
        videoId: row.youtube_video_id,
        channelId: row.youtube_channel_id,
        title: row.title,
        channelTitle: row.channel_title,
        publishedAt: row.published_at ?? '',
        transcriptFilePath: row.transcript_file_path ?? '',
        chunks: [],
      }
      batches.set(row.youtube_video_id, batch)
    }
    batch.chunks.push({
      chunkIndex: row.chunk_index,
      text: row.text,
      startSeconds: row.start_timestamp_seconds ?? undefined,
      endSeconds: row.end_timestamp_seconds ?? undefined,
      tokenCount: row.token_count,
    })
  }
  return [...batches.values()]
}
