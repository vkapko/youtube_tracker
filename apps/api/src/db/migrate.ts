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
      last_synced_at      TEXT,
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
      transcript_path     TEXT,
      summary_status      TEXT    NOT NULL DEFAULT 'pending',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id                  INTEGER NOT NULL REFERENCES videos(id),
      chunk_index               INTEGER NOT NULL,
      text                      TEXT    NOT NULL,
      start_timestamp_seconds   REAL,
      token_count               INTEGER,
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
      payload        TEXT    NOT NULL,
      error_message  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
