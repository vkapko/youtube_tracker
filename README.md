# YouTube Channel Content Tracker

A local-first personal knowledge base for YouTube channels. Add channels once; the app indexes their transcripts automatically and lets you search and chat across all of them.

## What it does

- Tracks YouTube channels and ingests new videos on a 24-hour schedule
- Extracts transcripts via `youtube-transcript`; falls back to manual paste
- Chunks and indexes transcripts in Chroma for semantic search
- Generates short summaries and key topics at ingestion time
- Answers natural language questions grounded in real transcript excerpts, with timestamps

## Prerequisites

- Node.js 20+
- Python 3.12+
- Docker (for Chroma)
- YouTube Data API key
- Anthropic API key

## Setup

Shell scripts are provided for a one-command setup:

- **macOS / Linux:** `./scripts/setup.sh`
- **Windows (PowerShell):** `.\scripts\setup.ps1`

Or run the steps manually:

```bash
# 1. Install Node dependencies
npm install

# 2. Install Python dependencies (for transcript extraction)
cd apps/api/python
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
cd ../../..

# 3. Copy env template and fill in your keys
cp .env.example .env

# 4. Start Chroma
docker compose up -d

# 5. Run database migrations
npm run db:migrate

# 6. Start the backend
npm run dev:api

# 7. Start the frontend (separate terminal)
npm run dev:web
```

The app runs at `http://localhost:5173`. The API runs at `http://localhost:4000`.

## Running the app

After setup, use these scripts to start everything:

**macOS / Linux**

```bash
./scripts/dev.sh
```

Starts Chroma, the API, and the web server. `Ctrl+C` stops all three.

**Windows (PowerShell)**

```powershell
.\scripts\dev.ps1
```

Starts Chroma and opens the API and web servers each in a separate terminal window.

## Environment variables

```env
PORT=4000

DATABASE_PATH=./data/app.sqlite
DATA_DIR=./data

YOUTUBE_API_KEY=...
ANTHROPIC_API_KEY=...

CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=youtube_transcript_chunks

CLAUDE_SUMMARY_MODEL=claude-sonnet-4-6
CLAUDE_CHAT_MODEL=claude-sonnet-4-6

# How often to sync tracked channels (hours)
SYNC_INTERVAL_HOURS=24
```

## Usage

**Add a video by URL**

Paste any YouTube URL into the Add Video page. The app fetches metadata, extracts the transcript, chunks and indexes it, then generates a short summary and key topics. The full pipeline runs in the background — you can watch job status in real time.

**Track a channel**

Paste a channel URL or handle (`@channelname`) on the Channels page. The app fetches all existing videos and ingests them, then checks for new ones every 24 hours automatically. You can also trigger a sync manually at any time.

**Search**

Enter a natural language query on the Search page. Results are grouped by video — one best-matching snippet per video, with a timestamp link to that moment. Use channel and date filters to scope the query. Click "N more matches" to see all matching moments on the Video Detail page.

**Chat**

Ask a question on the Chat page. The app retrieves the most relevant transcript chunks, sends them to Claude, and streams the answer with citations to specific videos and timestamps. Select which channels to include; your selection persists across messages in the session.

## Maintenance

**Reindex Chroma from SQLite**

If the vector index gets out of sync with the database (common during local development), rebuild it:

```bash
npm run reindex
```

This deletes the Chroma collection and re-inserts all chunks from SQLite. Transcript files and metadata are not affected. No transcripts are re-fetched.

> **Note:** Changing the Chroma embedding model invalidates all existing embeddings. Run `npm run reindex` after any model change.

**Manual transcript input**

If automatic transcript extraction fails for a video, the Video Detail page shows a prompt to paste or upload a `.txt` file. Videos with no YouTube captions (`unavailable`) and videos that failed extraction (`failed`) both support manual input.

## Architecture

```
React UI
  |
  | HTTP / SSE
  v
Node.js / Express (TypeScript)
  |
  +-- SQLite              metadata, chunks, jobs, summaries
  +-- data/transcripts/   raw transcript .txt files
  +-- data/summaries/     summary .md files
  +-- Chroma (Docker)     transcript chunk embeddings
  +-- YouTube Data API    video and channel metadata
  +-- youtube-transcript  caption extraction
  +-- Claude SDK          summarization and chat
```

Key design decisions are documented in `docs/adr/`. The domain glossary is in `CONTEXT.md`.

## Project structure

```
apps/
  api/        Node.js/Express backend
  web/        React/Vite frontend
data/
  app.sqlite
  transcripts/
  summaries/
  chroma/
docs/
  adr/        Architecture Decision Records
  prd-youtube-tracker.md
CONTEXT.md    Domain glossary
```

## YouTube API quota

The YouTube Data API free tier allows 10,000 units/day. At 50 tracked channels syncing once per day, a channel uploads list costs ~1 unit per page — well within the limit. If you track significantly more channels or reduce the sync interval, monitor your quota in the Google Cloud Console.
