# #009 — Streaming RAG chat

## What to build

A user asks a natural language question, the app retrieves the most relevant transcript chunks from Chroma, sends them to Claude with a grounded prompt, and streams the answer back token by token. Each answer cites the specific video and timestamp it drew from. The user's channel selection persists across messages in the session.

## Acceptance criteria

- [x] `POST /api/chat` accepts `{ question, channelIds?, topK? }` and responds with an SSE stream
- [x] Chroma is queried for the top-k chunks matching the question, filtered by `channelIds` when provided
- [x] Claude is called with a system prompt that instructs it to answer only from the provided excerpts and to cite video title and timestamp
- [x] Claude's response is streamed token by token via SSE to the frontend
- [x] The final SSE event includes structured `sources`: `[{ videoId, title, timestamp, reason }]`
- [x] If the retrieved chunks do not contain enough information, Claude responds with a clear "not enough information" message rather than hallucinating
- [x] Chat page renders a message thread with streaming token display
- [x] Source cards appear below each answer showing video title, timestamp, and a deep-link to that moment
- [x] A channel scope selector (multi-select or "all channels") appears above the chat input; the selection persists in frontend state across messages for the session
- [x] Chat history is maintained in frontend state for the session (not persisted to the database)
- [x] The Claude model used is read from `CLAUDE_CHAT_MODEL` env var

## Blocked by

- #005
- #007
