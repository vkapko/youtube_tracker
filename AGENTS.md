# Repository Guidelines

## Project Structure & Module Organization

This npm-workspaces monorepo contains two TypeScript applications:

- `apps/api/`: Express API; production code is in `src/`, tests in `tests/`.
- `apps/web/`: React/Vite client. Pages are in `src/pages/`, shared UI in `src/components/`, and component tests sit beside components as `*.test.tsx`.
- `docs/adr/`: architecture decisions; update these when changing documented designs.
- `docs/issues/`, `PROGRESS.md`: numbered implementation slices and their status.
- `CONTEXT.md`: domain glossary. Reuse its terms in code and documentation.
- `data/`: local runtime state, not source code.

## Build, Test, and Development Commands

Run commands from the repository root unless noted:

```bash
npm install                              # install workspace dependencies
docker compose up -d                     # start Chroma on port 8000
npm run db:migrate                       # apply SQLite migrations
npm run dev:api                          # API watcher on port 4000
npm run dev:web                          # Vite UI on port 5173
npm test --workspace=apps/api            # API test suite
npm test --workspace=apps/web            # web test suite
npm run typecheck --workspace=apps/api   # API type checks
npm run build --workspace=apps/web       # type-check and build the UI
npm run reindex                          # rebuild Chroma from SQLite
```

## Coding Style & Naming Conventions

Match existing TypeScript: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Use `camelCase` for values/functions, `PascalCase` for components/classes, and descriptive service names such as `transcriptIndexing.ts`. Keep route handlers thin and reusable behavior in `src/services/`. No linter is configured; follow nearby code.

## Testing Guidelines

Vitest runs both suites; web tests use Testing Library and `jsdom`, while API route tests use Supertest. Name tests `*.test.ts` or `*.test.tsx`. API tests should use in-memory SQLite and mock YouTube, Chroma, and other network boundaries. Add regression tests for fixes. Run the affected suite and type checks before submitting. No coverage threshold is enforced.

## Commit & Pull Request Guidelines

History generally follows Conventional Commits, often with issue references: `feat(#002): ingest video by URL`, `fix(api): load Vitest config as ESM`. Keep commits focused and imperative. Pull requests should describe behavior, link the issue, list verification commands, note schema/config changes, and include screenshots for UI changes. Update `PROGRESS.md` when completing a numbered issue.

## Security & Configuration

Use a local `.env` for API keys and paths; never commit secrets or generated `data/` contents. Preserve dependency injection around external services so tests remain offline and deterministic.
