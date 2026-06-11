import BetterSqlite3 from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { runMigration } from './migrate'

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (!_db) {
    const dbPath = process.env.DATABASE_PATH ?? path.resolve('data/db.sqlite')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    _db = new BetterSqlite3(dbPath)
    runMigration(_db)
  }
  return _db
}
