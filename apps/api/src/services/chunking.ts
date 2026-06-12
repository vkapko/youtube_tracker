import type { TranscriptResult } from './transcript'
import { countTokens as countModelTokens } from 'gpt-tokenizer'

export interface TranscriptChunk {
  chunkIndex: number
  text: string
  startSeconds?: number
  endSeconds?: number
  tokenCount: number
}

export interface ChunkingConfig {
  maxTokens?: number
  overlapSentences?: number
}

function countTokens(text: string): number {
  return text.trim() ? countModelTokens(text) : 0
}

interface Sentence {
  text: string
  startSeconds?: number
  tokenCount: number
}

function splitSentences(result: TranscriptResult): Sentence[] {
  return result.segments.flatMap(segment => {
    const matches = segment.text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? []
    return matches
      .map(text => text.trim())
      .filter(Boolean)
      .map(text => ({
        text,
        startSeconds: segment.startSeconds,
        tokenCount: countTokens(text),
      }))
  })
}

function toChunk(sentences: Sentence[], chunkIndex: number): TranscriptChunk {
  const timestamps = sentences
    .map(sentence => sentence.startSeconds)
    .filter((value): value is number => value !== undefined)

  return {
    chunkIndex,
    text: sentences.map(sentence => sentence.text).join(' '),
    startSeconds: sentences[0]?.startSeconds ?? 0,
    endSeconds: timestamps.at(-1),
    tokenCount: sentences.reduce((total, sentence) => total + sentence.tokenCount, 0),
  }
}

export function chunkTranscript(
  result: TranscriptResult,
  config: ChunkingConfig = {},
): TranscriptChunk[] {
  const maxTokens = config.maxTokens ?? 500
  const overlapSentences = config.overlapSentences ?? 2
  const sentences = splitSentences(result)
  const chunks: TranscriptChunk[] = []
  let current: Sentence[] = []
  let currentTokens = 0

  for (const sentence of sentences) {
    if (current.length > 0 && currentTokens + sentence.tokenCount > maxTokens) {
      chunks.push(toChunk(current, chunks.length))
      current = overlapSentences > 0 ? current.slice(-overlapSentences) : []
      currentTokens = current.reduce((total, item) => total + item.tokenCount, 0)
    }

    current.push(sentence)
    currentTokens += sentence.tokenCount
  }

  if (current.length > 0) chunks.push(toChunk(current, chunks.length))
  return chunks
}
