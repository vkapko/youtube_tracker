import 'dotenv/config'
import app from './app'
import { JobQueue, setJobQueue } from './services/jobQueue'
import { createIngestVideoWorker } from './services/ingestWorker'
import { createChannelSyncWorker } from './services/channelSyncWorker'

const PORT = process.env.PORT ?? '3001'

const queue = new JobQueue({
  ingest_video: createIngestVideoWorker(),
  channel_sync: createChannelSyncWorker(),
})
setJobQueue(queue)
queue.rehydrate()

app.listen(Number(PORT), () => {
  console.log(`API listening on port ${PORT}`)
})
