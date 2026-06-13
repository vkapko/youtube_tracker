import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../../.env') })
import app from './app'
import { getDb } from './db/database'
import { JobQueue, setJobQueue } from './services/jobQueue'
import { createIngestVideoWorker } from './services/ingestWorker'
import { createChannelSyncWorker } from './services/channelSyncWorker'
import { migratePublishedAtIfNeeded } from './services/reindex'
import { ClaudeService } from './services/claude.service'
import { startChannelSyncScheduler } from './services/channelSyncScheduler'
import { loadTranscriptConfig, buildTranscriptProvider } from './config/transcriptConfig'

const PORT = process.env.PORT ?? '3001'

;(async () => {
  let transcriptConfig
  try {
    transcriptConfig = loadTranscriptConfig()
  } catch (err) {
    console.error('Transcript configuration error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  let transcriptProvider
  try {
    transcriptProvider = buildTranscriptProvider(transcriptConfig)
  } catch (err) {
    console.error('Transcript provider startup validation failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  try {
    await migratePublishedAtIfNeeded(getDb())
  } catch (err) {
    console.warn('Chroma publishedAt migration check failed:', err)
  }

  const queue = new JobQueue({
    ingest_video: createIngestVideoWorker(undefined, new ClaudeService(), transcriptProvider),
    channel_sync: createChannelSyncWorker(),
  })
  setJobQueue(queue)
  queue.rehydrate()
  startChannelSyncScheduler(queue)

  app.listen(Number(PORT), () => {
    console.log(`API listening on port ${PORT}`)
  })
})()
