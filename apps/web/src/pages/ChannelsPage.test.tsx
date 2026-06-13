import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChannelsPage from './ChannelsPage'

const mockChannels = [
  {
    id: 1,
    youtube_channel_id: 'UCtest1',
    name: 'MKBHD',
    handle: 'mkbhd',
    thumbnail_url: null,
    last_checked_at: '2026-06-01T00:00:00',
    indexed_video_count: 10,
    failed_transcript_count: 2,
  },
  {
    id: 2,
    youtube_channel_id: 'UCtest2',
    name: 'Linus Tech Tips',
    handle: 'linustechtips',
    thumbnail_url: null,
    last_checked_at: null,
    indexed_video_count: 0,
    failed_transcript_count: 0,
  },
]

function makeFetch(opts: { channels?: unknown; addOk?: boolean } = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/channels' && init?.method === 'POST') {
      return Promise.resolve({
        ok: opts.addOk ?? true,
        json: () =>
          Promise.resolve(
            opts.addOk === false
              ? { error: 'Invalid channel URL or handle' }
              : { channelId: 99, youtubeChannelId: 'UCnew', jobId: 42 }
          ),
      })
    }
    if (url === '/api/channels') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ channels: opts.channels ?? [] }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ChannelsPage />
    </MemoryRouter>
  )
}

describe('ChannelsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders each channel name from the API', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: mockChannels }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('MKBHD')).toBeTruthy()
      expect(screen.getByText('Linus Tech Tips')).toBeTruthy()
    })
  })

  it('shows empty state when there are no channels', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: [] }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/no channels tracked yet/i)).toBeTruthy()
    })
  })

  it('shows indexed_video_count and failed_transcript_count for a channel', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: [mockChannels[0]] }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('10 indexed')).toBeTruthy()
      expect(screen.getByText('2 failed')).toBeTruthy()
    })
  })

  it('renders a "Sync now" button for each channel', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: mockChannels }))
    renderPage()
    await waitFor(() => screen.getByText('MKBHD'))
    const syncButtons = screen.getAllByRole('button', { name: /sync now/i })
    expect(syncButtons).toHaveLength(2)
  })

  it('POSTs the entered URL when the add form is submitted', async () => {
    const fetchMock = makeFetch({ channels: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '@mkbhd' } })
    fireEvent.click(screen.getByRole('button', { name: /add channel/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit]) => url === '/api/channels' && init?.method === 'POST'
      )
      expect(postCall).toBeTruthy()
      expect(JSON.parse(postCall![1].body as string)).toEqual({ url: '@mkbhd' })
    })
  })

  it('shows an error message when adding a channel fails', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: [], addOk: false }))
    renderPage()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-valid' } })
    fireEvent.click(screen.getByRole('button', { name: /add channel/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid channel url or handle/i)).toBeTruthy()
    })
  })
})
