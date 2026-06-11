import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
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

describe('runMigration — transcript_path column rename', () => {
  function legacyDb(): Database.Database {
    const db = new BetterSqlite3(':memory:')
    // Simulate a database created before #003 that used transcript_path instead of transcript_file_path
    db.exec(`
      CREATE TABLE channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        youtube_channel_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        youtube_video_id TEXT UNIQUE NOT NULL,
        channel_id INTEGER,
        title TEXT NOT NULL,
        transcript_status TEXT NOT NULL DEFAULT 'pending',
        transcript_path TEXT
      );
    `)
    return db
  }

  it('renames transcript_path to transcript_file_path on pre-#003 databases', () => {
    const db = legacyDb()
    runMigration(db)
    const cols = db.pragma('table_info(videos)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'transcript_file_path')).toBe(true)
    expect(cols.some(c => c.name === 'transcript_path')).toBe(false)
    db.close()
  })

  it('preserves data in the renamed column', () => {
    const db = legacyDb()
    db.prepare(`INSERT INTO channels (youtube_channel_id, name) VALUES ('UC1', 'Ch')`).run()
    db.prepare(
      `INSERT INTO videos (youtube_video_id, channel_id, title, transcript_path) VALUES ('vid1', 1, 'T', 'data/transcripts/UC1/vid1.txt')`
    ).run()

    runMigration(db)

    const row = db.prepare(`SELECT transcript_file_path FROM videos WHERE youtube_video_id = 'vid1'`).get() as any
    expect(row.transcript_file_path).toBe('data/transcripts/UC1/vid1.txt')
    db.close()
  })

  it('is idempotent when transcript_file_path already exists', () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)
    expect(() => runMigration(db)).not.toThrow()
    db.close()
  })
})
