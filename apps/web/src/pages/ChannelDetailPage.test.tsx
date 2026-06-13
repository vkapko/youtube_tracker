import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ChannelDetailPage from './ChannelDetailPage'

const mockChannel = {
  id: 1,
  youtube_channel_id: 'UCtest',
  name: 'MKBHD',
  handle: 'mkbhd',
  thumbnail_url: null,
  last_checked_at: '2026-06-01T00:00:00',
}

const mockVideos = [
  {
    youtube_video_id: 'vid1',
    title: 'Latest Video',
    transcript_status: 'available',
    summary_status: 'completed',
    published_at: '2026-05-15T00:00:00Z',
    thumbnail_url: null,
  },
  {
    youtube_video_id: 'vid2',
    title: 'Older Video',
    transcript_status: 'failed',
    summary_status: 'pending',
    published_at: '2026-01-10T00:00:00Z',
    thumbnail_url: null,
  },
]

function makeFetch(opts: {
  channelError?: string
  channel?: unknown
  videos?: unknown
} = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/channels/1/sync' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobId: 77, channelId: 1 }),
      })
    }
    if (url === '/api/channels/1') {
      return Promise.resolve({
        ok: !opts.channelError,
        json: () =>
          Promise.resolve(
            opts.channelError
              ? { error: opts.channelError }
              : { channel: opts.channel ?? mockChannel, videos: opts.videos ?? mockVideos }
          ),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/channels/1']}>
      <Routes>
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ChannelDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the channel name and handle', async () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('MKBHD')).toBeTruthy()
      expect(screen.getByText('@mkbhd')).toBeTruthy()
    })
  })

  it('lists all videos with their titles', async () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Latest Video')).toBeTruthy()
      expect(screen.getByText('Older Video')).toBeTruthy()
    })
  })

  it('shows transcript_status badges for each video', async () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('available')).toBeTruthy()
      expect(screen.getByText('failed')).toBeTruthy()
    })
  })

  it('shows indexed and failed counts derived from video statuses', async () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1 indexed')).toBeTruthy()
      expect(screen.getByText('1 failed')).toBeTruthy()
    })
  })

  it('displays an error message when the channel API returns an error', async () => {
    vi.stubGlobal('fetch', makeFetch({ channelError: 'Channel not found' }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Channel not found')).toBeTruthy()
    })
  })

  it('clicking "Sync now" POSTs to /api/channels/:id/sync', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /sync now/i }))

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() => {
      const syncCall = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit]) =>
          url === '/api/channels/1/sync' && init?.method === 'POST'
      )
      expect(syncCall).toBeTruthy()
    })
  })

  it('shows "Syncing…" and disables the button after sync is triggered', async () => {
    let resolveSyncJob!: () => void
    const syncDelay = new Promise<void>(res => { resolveSyncJob = res })

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/channels/1/sync' && init?.method === 'POST') {
        return syncDelay.then(() => ({
          ok: true,
          json: () => Promise.resolve({ jobId: 77, channelId: 1 }),
        }))
      }
      if (url === '/api/channels/1') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channel: mockChannel, videos: mockVideos }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /sync now/i }))

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /syncing/i })
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    })

    resolveSyncJob()
  })
})
