import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { runMigration } from '../src/db/migrate'

describe('runMigration', () => {
  let db: BetterSqlite3.Database

  beforeAll(() => {
    db = new BetterSqlite3(':memory:')
    runMigration(db)
  })

  afterAll(() => {
    db.close()
  })

  const tables = ['channels', 'videos', 'transcript_chunks', 'summaries', 'ingestion_jobs']

  for (const table of tables) {
    it(`creates the ${table} table`, () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
      expect(row).toBeDefined()
    })
  }
})
