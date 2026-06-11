# ADR 0002 — Embedding Model: Chroma Default

## Status
Accepted

## Context
The Node.js backend needs to embed transcript chunks before storing them in Chroma. Options include: Chroma's built-in model, OpenAI embeddings API, local models via `@xenova/transformers`, and others.

## Decision
Use Chroma's default embedding model (`all-MiniLM-L6-v2`) running inside the Chroma Docker container. The Node backend sends raw text; Chroma handles embedding internally.

## Consequences
- Zero extra code or API keys in the Node backend for embedding.
- Requires Chroma Docker container to be running (already required for vector storage).
- If search quality is insufficient, switching to OpenAI `text-embedding-3-small` requires only changing how chunks are inserted — Chroma supports pre-computed vectors.
- Model is not configurable at runtime without reindexing (changing models invalidates all existing embeddings).
