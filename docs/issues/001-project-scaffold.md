# #001 — Project scaffold

## What to build

Set up the full monorepo skeleton so every subsequent slice has a working foundation to build on. This includes the Node/Express API, Vite/React frontend, SQLite schema with migrations, Docker Compose for Chroma, and environment variable wiring. No business logic — just a running stack with a health check.

## Acceptance criteria

- [x] Monorepo with `apps/api` (Node/Express/TypeScript) and `apps/web` (Vite/React/TypeScript)
- [x] `GET /api/health` returns `{ status: "ok" }`
- [x] SQLite database initialised with full schema (`channels`, `videos`, `transcript_chunks`, `summaries`, `ingestion_jobs`) via a migration script (`npm run db:migrate`)
- [x] `docker-compose.yml` starts Chroma on port 8000; `GET http://localhost:8000/api/v1/heartbeat` returns OK
- [x] `.env.example` documents all required environment variables
- [x] `npm run dev:api` and `npm run dev:web` start both apps in development mode
- [x] TypeScript compiles without errors in both apps

## Blocked by

None — can start immediately.
