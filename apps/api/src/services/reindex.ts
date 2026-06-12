import type Database from 'better-sqlite3'
import { getAvailableTranscriptChunkBatches } from '../db/transcriptChunks'
import { ChromaService, type IndexChunksOptions } from './chroma'

interface ReindexChromaClient {
  resetCollection(): Promise<void>
  indexChunks(options: IndexChunksOptions): Promise<void>
}

interface MigrateChromaClient extends ReindexChromaClient {
  hasStringPublishedAt(): Promise<boolean>
}

export async function migratePublishedAtIfNeeded(
  db: Database.Database,
  chroma: MigrateChromaClient = new ChromaService(),
): Promise<boolean> {
  if (!(await chroma.hasStringPublishedAt())) return false
  console.log('Migrating Chroma publishedAt from ISO strings to epoch seconds...')
  await reindexAvailableTranscripts(db, chroma)
  console.log('Chroma publishedAt migration complete.')
  return true
}

export async function reindexAvailableTranscripts(
  db: Database.Database,
  chroma: ReindexChromaClient = new ChromaService(),
): Promise<number> {
  const batches = getAvailableTranscriptChunkBatches(db)
  await chroma.resetCollection()
  for (const batch of batches) {
    await chroma.indexChunks(batch)
  }
  return batches.reduce((total, batch) => total + batch.chunks.length, 0)
}
