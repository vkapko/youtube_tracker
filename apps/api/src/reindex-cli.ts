import 'dotenv/config'
import { getDb } from './db/database'
import { reindexAvailableTranscripts } from './services/reindex'

reindexAvailableTranscripts(getDb())
  .then(count => {
    console.log(`Reindexed ${count} transcript chunks`)
  })
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
