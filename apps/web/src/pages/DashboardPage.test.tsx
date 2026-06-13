import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

const dashboard = {
  totalChannels: 3,
  totalIndexedVideos: 24,
  videosWithoutTranscripts: 4,
  totalFailedIngestionJobs: 2,
  recentlyIngestedVideos: [
    {
      youtubeVideoId: 'video-1',
      title: 'Latest Research Video',
      thumbnailUrl: 'https://example.com/video.jpg',
      transcriptStatus: 'available',
      ingestedAt: '2026-06-13 12:00:00',
      channelName: 'Research Channel',
    },
  ],
  recentlyFailedJobs: [
    {
      id: 17,
      type: 'ingest_video',
      payload: { youtubeVideoId: 'failed-video' },
      errorMessage: 'Transcript unavailable',
      failedAt: '2026-06-13 11:00:00',
    },
  ],
}

describe('DashboardPage', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('displays knowledge base totals, linked recent videos, and failed jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboard),
    }))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Latest Research Video')).toBeTruthy())
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Latest Research Video' }).getAttribute('href'))
      .toBe('/videos/video-1')
    expect(screen.getByText('Transcript unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('refreshes dashboard data every 30 seconds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboard),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a failed job and refreshes the dashboard', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/jobs/17/retry' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobId: 18, originalJobId: 17 }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(dashboard),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByRole('button', { name: /retry/i }))

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/17/retry', { method: 'POST' })
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/dashboard')).toHaveLength(2)
    })
  })
})
