import 'dotenv/config'
import app from './app'
import { getDb } from './db/database'
import { JobQueue, setJobQueue } from './services/jobQueue'
import { createIngestVideoWorker } from './services/ingestWorker'
import { createChannelSyncWorker } from './services/channelSyncWorker'
import { migratePublishedAtIfNeeded } from './services/reindex'
import { ClaudeService } from './services/claude.service'
import { startChannelSyncScheduler } from './services/channelSyncScheduler'

const PORT = process.env.PORT ?? '3001'

;(async () => {
  try {
    await migratePublishedAtIfNeeded(getDb())
  } catch (err) {
    console.warn('Chroma publishedAt migration check failed:', err)
  }

  const queue = new JobQueue({
    ingest_video: createIngestVideoWorker(undefined, new ClaudeService()),
    channel_sync: createChannelSyncWorker(),
  })
  setJobQueue(queue)
  queue.rehydrate()
  startChannelSyncScheduler(queue)

  app.listen(Number(PORT), () => {
    console.log(`API listening on port ${PORT}`)
  })
})()
