import { describe, it, expect, vi } from 'vitest'
import { ManualTranscriptProvider, YouTubeTranscriptProvider } from '../src/services/transcript'
import * as ytLib from 'youtube-transcript'

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}))

describe('ManualTranscriptProvider', () => {
  it('returns a TranscriptResult with source manual and the input as plainText', async () => {
    const provider = new ManualTranscriptProvider('Hello world.\nSecond line.')
    const result = await provider.getTranscript('abc123')
    expect(result.videoId).toBe('abc123')
    expect(result.source).toBe('manual')
    expect(result.plainText).toBe('Hello world.\nSecond line.')
  })

  it('produces a single segment with no timestamp', async () => {
    const provider = new ManualTranscriptProvider('Some text')
    const result = await provider.getTranscript('vid1')
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].text).toBe('Some text')
    expect(result.segments[0].startSeconds).toBeUndefined()
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
    const result = await provider.getTranscript('abc123')
    expect(result.videoId).toBe('abc123')
    expect(result.source).toBe('extractor')
    expect(result.segments).toEqual([
      { startSeconds: 0, text: 'Hello' },
      { startSeconds: 5, text: 'World' },
    ])
    expect(result.plainText).toBe('Hello World')
  })

  it('rethrows unexpected errors from the library', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))
    const provider = new YouTubeTranscriptProvider()
    await expect(provider.getTranscript('abc123')).rejects.toThrow('Network failure')
  })
})
