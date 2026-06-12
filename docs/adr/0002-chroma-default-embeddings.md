# ADR 0002 — Embedding Model: Chroma Default

## Status
Accepted

## Context
The Node.js backend needs to embed transcript chunks before storing them in Chroma. Options include: Chroma's built-in model, OpenAI embeddings API, local models via `@xenova/transformers`, and others.

## Decision
Use the Chroma JavaScript SDK's default embedding function (`Xenova/all-MiniLM-L6-v2`). The Node backend passes raw text to the SDK, which generates embeddings locally in the API process before sending vectors and documents to the Chroma server.

## Consequences
- No embedding API key or application-managed embedding code is required.
- The API process downloads and runs the default model locally; the Chroma Docker container stores and searches the resulting vectors.
- If search quality is insufficient, switching to OpenAI `text-embedding-3-small` requires only changing how chunks are inserted — Chroma supports pre-computed vectors.
- Model is not configurable at runtime without reindexing (changing models invalidates all existing embeddings).
