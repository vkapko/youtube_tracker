import { describe, it, expect, vi } from 'vitest'
import { ManualTranscriptProvider, YouTubeTranscriptProvider } from '../src/services/transcript'
import * as ytLib from 'youtube-transcript'

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}))

describe('ManualTranscriptProvider', () => {
  it('returns status ok with source manual and the input as plainText', async () => {
    const provider = new ManualTranscriptProvider('Hello world.\nSecond line.')
    const acquisition = await provider.getTranscript('abc123')
    expect(acquisition.status).toBe('ok')
    if (acquisition.status !== 'ok') return
    expect(acquisition.transcript.videoId).toBe('abc123')
    expect(acquisition.transcript.source).toBe('manual')
    expect(acquisition.transcript.plainText).toBe('Hello world.\nSecond line.')
  })

  it('produces a single segment with no timestamp', async () => {
    const provider = new ManualTranscriptProvider('Some text')
    const acquisition = await provider.getTranscript('vid1')
    expect(acquisition.status).toBe('ok')
    if (acquisition.status !== 'ok') return
    expect(acquisition.transcript.segments).toHaveLength(1)
    expect(acquisition.transcript.segments[0].text).toBe('Some text')
    expect(acquisition.transcript.segments[0].startSeconds).toBeUndefined()
  })
})

describe('YouTubeTranscriptProvider', () => {
  const mockFetch = vi.mocked(ytLib.YoutubeTranscript.fetchTranscript)

  it('normalizes library output into a TranscriptResult with source extractor', async () => {
    mockFetch.mockResolvedValueOnce([
      { text: 'Hello', offset: 0, duration: 2000 },
      { text: 'World', offset: 5000, duration: 3000 },
    ])
    const provider = new YouTubeTranscriptProvider()
    const acquisition = await provider.getTranscript('abc123')
    expect(acquisition.status).toBe('ok')
    if (acquisition.status !== 'ok') return
    expect(acquisition.transcript.videoId).toBe('abc123')
    expect(acquisition.transcript.source).toBe('extractor')
    expect(acquisition.transcript.segments).toEqual([
      { startSeconds: 0, text: 'Hello' },
      { startSeconds: 5, text: 'World' },
    ])
    expect(acquisition.transcript.plainText).toBe('Hello World')
  })

  it('rethrows unexpected errors from the library', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))
    const provider = new YouTubeTranscriptProvider()
    await expect(provider.getTranscript('abc123')).rejects.toThrow('Network failure')
  })
})
