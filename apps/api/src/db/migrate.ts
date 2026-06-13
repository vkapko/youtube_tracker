import type Database from 'better-sqlite3'

export function runMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_channel_id  TEXT    UNIQUE NOT NULL,
      name                TEXT    NOT NULL,
      handle              TEXT,
      description         TEXT,
      thumbnail_url       TEXT,
      last_checked_at     TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_video_id    TEXT    UNIQUE NOT NULL,
      channel_id          INTEGER REFERENCES channels(id),
      title               TEXT    NOT NULL,
      description         TEXT,
      duration_seconds    INTEGER,
      published_at        TEXT,
      thumbnail_url       TEXT,
      has_captions        INTEGER,
      transcript_status   TEXT    NOT NULL DEFAULT 'pending',
      transcript_file_path TEXT,
      summary_status      TEXT    NOT NULL DEFAULT 'pending',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id                  INTEGER NOT NULL REFERENCES videos(id),
      chunk_index               INTEGER NOT NULL,
      text                      TEXT    NOT NULL,
      start_timestamp_seconds   REAL,
      end_timestamp_seconds     REAL,
      token_count               INTEGER,
      chroma_document_id        TEXT,
      created_at                TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id    INTEGER NOT NULL REFERENCES videos(id),
      type        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(video_id, type)
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      type           TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'queued',
      stage          TEXT,
      payload        TEXT    NOT NULL,
      error_message  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Add stage column to ingestion_jobs for databases created before this migration
  const jobCols = db.pragma('table_info(ingestion_jobs)') as Array<{ name: string }>
  if (!jobCols.some(c => c.name === 'stage')) {
    db.exec(`ALTER TABLE ingestion_jobs ADD COLUMN stage TEXT`)
  }

  // Rename transcript_path → transcript_file_path (databases created before #003 used the old name)
  const cols = db.pragma('table_info(videos)') as Array<{ name: string }>
  const hasOld = cols.some(c => c.name === 'transcript_path')
  const hasNew = cols.some(c => c.name === 'transcript_file_path')
  if (hasOld && !hasNew) {
    db.exec(`ALTER TABLE videos RENAME COLUMN transcript_path TO transcript_file_path`)
  }

  // Rename last_synced_at → last_checked_at (databases created before #010 used the old name)
  const channelCols = db.pragma('table_info(channels)') as Array<{ name: string }>
  if (channelCols.some(c => c.name === 'last_synced_at') && !channelCols.some(c => c.name === 'last_checked_at')) {
    db.exec(`ALTER TABLE channels RENAME COLUMN last_synced_at TO last_checked_at`)
  }

  const chunkCols = db.pragma('table_info(transcript_chunks)') as Array<{ name: string }>
  if (!chunkCols.some(c => c.name === 'chroma_document_id')) {
    db.exec(`ALTER TABLE transcript_chunks ADD COLUMN chroma_document_id TEXT`)
  }
  if (!chunkCols.some(c => c.name === 'end_timestamp_seconds')) {
    db.exec(`ALTER TABLE transcript_chunks ADD COLUMN end_timestamp_seconds REAL`)
  }
}
