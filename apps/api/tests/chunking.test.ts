import { describe, expect, it } from 'vitest'
import { chunkTranscript } from '../src/services/chunking'
import type { TranscriptResult } from '../src/services/transcript'

describe('chunkTranscript', () => {
  it('keeps a short transcript in one timestamped chunk', () => {
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'extractor',
      segments: [
        { startSeconds: 4, text: 'First sentence.' },
        { startSeconds: 9, text: 'Second sentence.' },
      ],
      plainText: 'First sentence. Second sentence.',
    }

    expect(chunkTranscript(transcript, { maxTokens: 20 })).toEqual([
      {
        chunkIndex: 0,
        text: 'First sentence. Second sentence.',
        startSeconds: 4,
        endSeconds: 9,
        tokenCount: 6,
      },
    ])
  })

  it('splits a long transcript at sentence boundaries with overlap', () => {
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'extractor',
      segments: [
        { startSeconds: 0, text: 'One alpha.' },
        { startSeconds: 5, text: 'Two beta.' },
        { startSeconds: 10, text: 'Three gamma.' },
        { startSeconds: 15, text: 'Four delta.' },
      ],
      plainText: 'One alpha. Two beta. Three gamma. Four delta.',
    }

    expect(chunkTranscript(transcript, { maxTokens: 6, overlapSentences: 1 })).toEqual([
      {
        chunkIndex: 0,
        text: 'One alpha. Two beta.',
        startSeconds: 0,
        endSeconds: 5,
        tokenCount: 6,
      },
      {
        chunkIndex: 1,
        text: 'Two beta. Three gamma.',
        startSeconds: 5,
        endSeconds: 10,
        tokenCount: 6,
      },
      {
        chunkIndex: 2,
        text: 'Three gamma. Four delta.',
        startSeconds: 10,
        endSeconds: 15,
        tokenCount: 6,
      },
    ])
  })

  it('preserves overlap when the next sentence fills the token budget', () => {
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'extractor',
      segments: [
        { startSeconds: 0, text: 'One alpha.' },
        { startSeconds: 5, text: 'one two three four five six seven.' },
      ],
      plainText: 'One alpha. one two three four five six seven.',
    }

    expect(chunkTranscript(transcript, { maxTokens: 8, overlapSentences: 1 })).toEqual([
      {
        chunkIndex: 0,
        text: 'One alpha.',
        startSeconds: 0,
        endSeconds: 0,
        tokenCount: 3,
      },
      {
        chunkIndex: 1,
        text: 'One alpha. one two three four five six seven.',
        startSeconds: 0,
        endSeconds: 5,
        tokenCount: 11,
      },
    ])
  })

  it('chunks a transcript with no timestamps', () => {
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'manual',
      segments: [{ text: 'First sentence. Second sentence.' }],
      plainText: 'First sentence. Second sentence.',
    }

    expect(chunkTranscript(transcript, { maxTokens: 20 })).toEqual([
      {
        chunkIndex: 0,
        text: 'First sentence. Second sentence.',
        startSeconds: undefined,
        endSeconds: undefined,
        tokenCount: 6,
      },
    ])
  })

  it('keeps a single oversized sentence intact', () => {
    const text = 'one two three four five six seven.'
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'extractor',
      segments: [{ startSeconds: 12, text }],
      plainText: text,
    }

    expect(chunkTranscript(transcript, { maxTokens: 5 })).toEqual([
      {
        chunkIndex: 0,
        text,
        startSeconds: 12,
        endSeconds: 12,
        tokenCount: 8,
      },
    ])
  })

  it('uses model tokens rather than whitespace-delimited words', () => {
    const sentence = 'antidisestablishmentarianism.'
    const transcript: TranscriptResult = {
      videoId: 'video-1',
      source: 'manual',
      segments: [{ text: `${sentence} ${sentence}` }],
      plainText: `${sentence} ${sentence}`,
    }

    expect(chunkTranscript(transcript, { maxTokens: 8, overlapSentences: 0 })).toEqual([
      {
        chunkIndex: 0,
        text: sentence,
        startSeconds: undefined,
        endSeconds: undefined,
        tokenCount: 7,
      },
      {
        chunkIndex: 1,
        text: sentence,
        startSeconds: undefined,
        endSeconds: undefined,
        tokenCount: 7,
      },
    ])
  })
})
