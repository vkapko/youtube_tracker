import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChannelNotFoundError, resolveChannel } from '../src/lib/youtubeApi'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const originalEnv = process.env.YOUTUBE_API_KEY

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'test-key'
  mockFetch.mockReset()
})

function apiResponse(item?: object) {
  return {
    ok: true,
    json: async () => ({ items: item ? [item] : [] }),
  }
}

const channelItem = {
  id: 'UCBcRF18a7Qf58cMAttLomGg',
  snippet: {
    title: 'MKBHD',
    customUrl: '@mkbhd',
    thumbnails: { high: { url: 'https://example.com/thumb.jpg' } },
  },
}

describe('resolveChannel', () => {
  describe('handle type', () => {
    it('calls forHandle and returns channel', async () => {
      mockFetch.mockResolvedValueOnce(apiResponse(channelItem))

      const result = await resolveChannel({ type: 'handle', value: 'mkbhd' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toContain('forHandle=mkbhd')
      expect(result.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
      expect(result.handle).toBe('mkbhd')
    })

    it('throws ChannelNotFoundError when the handle does not exist', async () => {
      mockFetch.mockResolvedValueOnce(apiResponse())

      await expect(resolveChannel({ type: 'handle', value: 'missing' })).rejects.toBeInstanceOf(
        ChannelNotFoundError
      )
    })
  })

  describe('id type', () => {
    it('calls id= param and returns channel', async () => {
      mockFetch.mockResolvedValueOnce(apiResponse(channelItem))

      const result = await resolveChannel({ type: 'id', value: 'UCBcRF18a7Qf58cMAttLomGg' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toContain('id=UCBcRF18a7Qf58cMAttLomGg')
      expect(result.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
    })
  })

  describe('customUrl type (/c/ URLs)', () => {
    it('resolves on first try (forHandle) when slug matches handle', async () => {
      mockFetch.mockResolvedValueOnce(apiResponse(channelItem))

      const result = await resolveChannel({ type: 'customUrl', value: 'mkbhd' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toContain('forHandle=mkbhd')
      expect(result.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
    })

    it('falls back to forUsername when forHandle returns no results', async () => {
      mockFetch
        .mockResolvedValueOnce(apiResponse()) // forHandle → empty
        .mockResolvedValueOnce(apiResponse(channelItem)) // forUsername → hit

      const result = await resolveChannel({ type: 'customUrl', value: 'mkbhd' })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.mock.calls[0][0]).toContain('forHandle=mkbhd')
      expect(mockFetch.mock.calls[1][0]).toContain('forUsername=mkbhd')
      expect(result.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
    })

    it('resolves the canonical channel id from the legacy custom URL page', async () => {
      mockFetch
        .mockResolvedValueOnce(apiResponse())
        .mockResolvedValueOnce(apiResponse())
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://www.youtube.com/c/oldslug',
          text: async () => '<meta itemprop="channelId" content="UCBcRF18a7Qf58cMAttLomGg">',
        })
        .mockResolvedValueOnce(apiResponse(channelItem))

      const result = await resolveChannel({ type: 'customUrl', value: 'oldslug' })

      expect(mockFetch).toHaveBeenCalledTimes(4)
      expect(mockFetch.mock.calls[2][0]).toBe('https://www.youtube.com/c/oldslug')
      expect(mockFetch.mock.calls[3][0]).toContain('id=UCBcRF18a7Qf58cMAttLomGg')
      expect(result.youtubeChannelId).toBe('UCBcRF18a7Qf58cMAttLomGg')
    })

    it('throws a helpful error when the custom URL page cannot be resolved', async () => {
      mockFetch
        .mockResolvedValueOnce(apiResponse())
        .mockResolvedValueOnce(apiResponse())
        .mockResolvedValueOnce({
          ok: false,
          url: 'https://www.youtube.com/c/oldslug',
          text: async () => '',
        })

      const result = resolveChannel({ type: 'customUrl', value: 'oldslug' })
      await expect(result).rejects.toBeInstanceOf(ChannelNotFoundError)
      await expect(result).rejects.toThrow(/Could not resolve legacy custom URL.*@oldslug/s)
    })
  })
})
