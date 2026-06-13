import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../../../.env') })
import BetterSqlite3 from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { runMigration } from './migrate'

const dbPath = process.env.DATABASE_PATH ?? path.resolve('data/db.sqlite')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new BetterSqlite3(dbPath)
runMigration(db)
db.close()
console.log(`Migration complete — ${dbPath}`)
