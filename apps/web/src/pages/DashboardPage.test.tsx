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
      errorCode: null,
      retryable: null,
      failedAt: '2026-06-13 11:00:00',
    },
  ],
}

const nonRetryableDashboard = {
  ...dashboard,
  recentlyFailedJobs: [
    {
      id: 42,
      type: 'ingest_video',
      payload: { youtubeVideoId: 'blocked' },
      errorMessage: 'Missing Python dependency',
      errorCode: 'dependency_error',
      retryable: false,
      failedAt: '2026-06-13 10:00:00',
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

  it('disables the retry button and shows force retry for non-retryable jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(nonRetryableDashboard),
    }))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByRole('button', { name: /^retry$/i }))

    expect((screen.getByRole('button', { name: /^retry$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /force retry/i })).toBeTruthy()
  })

  it('shows the error code for non-retryable jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(nonRetryableDashboard),
    }))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByText('Error code: dependency_error'))
  })

  it('calls the API with force=true when force retry is confirmed', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/jobs/42/retry' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobId: 43, originalJobId: 42 }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(nonRetryableDashboard),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByRole('button', { name: /force retry/i }))
    fireEvent.click(screen.getByRole('button', { name: /force retry/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/42/retry', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ force: true }),
      }))
    })
  })

  it('does not call the API when force retry confirmation is cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(nonRetryableDashboard),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByRole('button', { name: /force retry/i }))
    const callsBefore = fetchMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /force retry/i }))

    expect(fetchMock).toHaveBeenCalledTimes(callsBefore)
  })
})
