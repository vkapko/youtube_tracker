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

  it('creates the Chroma document id column for transcript chunks', () => {
    const cols = db.pragma('table_info(transcript_chunks)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'chroma_document_id')).toBe(true)
  })
})

describe('runMigration — transcript chunk Chroma document id', () => {
  it('adds chroma_document_id to existing transcript chunk tables', () => {
    const db = new BetterSqlite3(':memory:')
    db.exec(`
      CREATE TABLE transcript_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
    `)

    runMigration(db)

    const cols = db.pragma('table_info(transcript_chunks)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'chroma_document_id')).toBe(true)
    db.close()
  })
})

describe('runMigration — ingestion_jobs error metadata columns', () => {
  it('creates error_code and retryable as nullable columns on a fresh database', () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)
    const cols = db.pragma('table_info(ingestion_jobs)') as Array<{ name: string; notnull: number }>
    const errorCode = cols.find(c => c.name === 'error_code')
    const retryable = cols.find(c => c.name === 'retryable')
    expect(errorCode).toBeDefined()
    expect(retryable).toBeDefined()
    expect(errorCode!.notnull).toBe(0)
    expect(retryable!.notnull).toBe(0)
    db.close()
  })

  it('adds error_code and retryable to existing ingestion_jobs tables without them', () => {
    const db = new BetterSqlite3(':memory:')
    db.exec(`
      CREATE TABLE ingestion_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    runMigration(db)

    const cols = db.pragma('table_info(ingestion_jobs)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'error_code')).toBe(true)
    expect(cols.some(c => c.name === 'retryable')).toBe(true)
    db.close()
  })

  it('does not affect existing rows when adding error_code and retryable', () => {
    const db = new BetterSqlite3(':memory:')
    db.exec(`
      CREATE TABLE ingestion_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES ('ingest_video', 'failed', '{}')`).run()

    runMigration(db)

    const row = db.prepare('SELECT error_code, retryable FROM ingestion_jobs').get() as any
    expect(row.error_code).toBeNull()
    expect(row.retryable).toBeNull()
    db.close()
  })

  it('is idempotent when error_code and retryable already exist', () => {
    const db = new BetterSqlite3(':memory:')
    runMigration(db)
    expect(() => runMigration(db)).not.toThrow()
    db.close()
  })
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
