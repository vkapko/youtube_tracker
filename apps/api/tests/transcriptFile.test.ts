import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { saveTranscript, parseTranscriptFile } from '../src/services/transcriptFile'
import type { TranscriptResult } from '../src/services/transcript'

describe('saveTranscript', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-transcript-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const baseOpts = {
    channelId: 'UCabc123',
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channelName: 'Rick Astley',
    publishedAt: '1987-10-25',
    result: {
      videoId: 'dQw4w9WgXcQ',
      source: 'extractor',
      segments: [
        { startSeconds: 0, text: 'Introduction' },
        { startSeconds: 62, text: 'Main chorus' },
      ],
      plainText: 'Introduction Main chorus',
    } satisfies TranscriptResult,
  }

  it('saves the file to {dataDir}/transcripts/{channelId}/{videoId}.txt', async () => {
    const filePath = await saveTranscript({ ...baseOpts, dataDir: tmpDir })
    const expected = path.join(tmpDir, 'transcripts', 'UCabc123', 'dQw4w9WgXcQ.txt')
    expect(filePath).toBe(expected)
    await expect(fs.access(expected)).resolves.toBeUndefined()
  })

  it('writes the header block with all metadata fields', async () => {
    const filePath = await saveTranscript({ ...baseOpts, dataDir: tmpDir })
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('Title: Never Gonna Give You Up')
    expect(content).toContain('Channel: Rick Astley')
    expect(content).toContain('Video ID: dQw4w9WgXcQ')
    expect(content).toContain('URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(content).toContain('Published: 1987-10-25')
  })

  it('writes timestamped segments after a blank line', async () => {
    const filePath = await saveTranscript({ ...baseOpts, dataDir: tmpDir })
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('[00:00:00] Introduction')
    expect(content).toContain('[00:01:02] Main chorus')
  })

  it('writes manual segments without a timestamp prefix', async () => {
    const manualResult: TranscriptResult = {
      videoId: 'dQw4w9WgXcQ',
      source: 'manual',
      segments: [{ text: 'Full transcript text here.' }],
      plainText: 'Full transcript text here.',
    }
    const filePath = await saveTranscript({ ...baseOpts, result: manualResult, dataDir: tmpDir })
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('Full transcript text here.')
    expect(content).not.toContain('[')
  })
})

describe('parseTranscriptFile round-trip', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-transcript-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('parses timestamped segments written by saveTranscript', async () => {
    const result: TranscriptResult = {
      videoId: 'dQw4w9WgXcQ',
      source: 'extractor',
      segments: [
        { startSeconds: 0, text: 'Introduction' },
        { startSeconds: 62, text: 'Main chorus' },
        { startSeconds: 3661, text: 'Outro' },
      ],
      plainText: 'Introduction Main chorus Outro',
    }
    const filePath = await saveTranscript({
      channelId: 'UCabc123',
      videoId: 'dQw4w9WgXcQ',
      title: 'Test',
      channelName: 'Tester',
      publishedAt: '2024-01-01',
      result,
      dataDir: tmpDir,
    })
    const content = await fs.readFile(filePath, 'utf8')
    const segments = parseTranscriptFile(content)

    expect(segments).toEqual([
      { startSeconds: 0, text: 'Introduction' },
      { startSeconds: 62, text: 'Main chorus' },
      { startSeconds: 3661, text: 'Outro' },
    ])
  })

  it('parses manual (no-timestamp) segments written by saveTranscript', async () => {
    const result: TranscriptResult = {
      videoId: 'dQw4w9WgXcQ',
      source: 'manual',
      segments: [{ text: 'Line one.' }, { text: 'Line two.' }],
      plainText: 'Line one. Line two.',
    }
    const filePath = await saveTranscript({
      channelId: 'UCabc123',
      videoId: 'dQw4w9WgXcQ',
      title: 'Test',
      channelName: 'Tester',
      publishedAt: '2024-01-01',
      result,
      dataDir: tmpDir,
    })
    const content = await fs.readFile(filePath, 'utf8')
    const segments = parseTranscriptFile(content)

    expect(segments).toEqual([{ text: 'Line one.' }, { text: 'Line two.' }])
  })
})
