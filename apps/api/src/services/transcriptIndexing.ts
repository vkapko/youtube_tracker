import type Database from 'better-sqlite3'
import { replaceTranscriptChunks } from '../db/transcriptChunks'
import { chunkTranscript, type TranscriptChunk } from './chunking'
import { ChromaService, type IndexChunksOptions } from './chroma'
import type { TranscriptResult } from './transcript'

interface ChromaIndexer {
  indexChunks(options: IndexChunksOptions): Promise<void>
}

export interface IndexTranscriptOptions extends Omit<IndexChunksOptions, 'chunks'> {
  videoDbId: number
  transcript: TranscriptResult
}

export class TranscriptIndexer {
  constructor(
    private readonly db: Database.Database,
    private readonly chroma: ChromaIndexer = new ChromaService(),
  ) {}

  async indexTranscript(options: IndexTranscriptOptions): Promise<TranscriptChunk[]> {
    const chunks = chunkTranscript(options.transcript)
    replaceTranscriptChunks(this.db, options.videoDbId, options.videoId, chunks)
    await this.chroma.indexChunks({
      videoId: options.videoId,
      channelId: options.channelId,
      title: options.title,
      channelTitle: options.channelTitle,
      publishedAt: options.publishedAt,
      transcriptFilePath: options.transcriptFilePath,
      chunks,
    })
    return chunks
  }
}
