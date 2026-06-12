import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from './SearchPage'

const mockChannels = [
  { id: 1, youtube_channel_id: 'UCchannel1', name: 'Channel One', thumbnail_url: null },
  { id: 2, youtube_channel_id: 'UCchannel2', name: 'Channel Two', thumbnail_url: null },
]

const mockSearchResult = {
  videoId: 'abc123',
  title: 'Test Video Title',
  channelName: 'Channel One',
  publishedAt: '2025-01-15T00:00:00Z',
  thumbnailUrl: null,
  snippet: 'A relevant transcript snippet about the topic.',
  startSeconds: 42,
  youtubeUrl: 'https://www.youtube.com/watch?v=abc123&t=42s',
  score: 0.85,
}

function makeFetch(opts: {
  channels?: unknown
  searchResults?: unknown
  searchOk?: boolean
} = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/channels') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ channels: opts.channels ?? [] }),
      })
    }
    return Promise.resolve({
      ok: opts.searchOk ?? true,
      json: () => Promise.resolve(
        opts.searchOk === false
          ? { error: 'Search service unavailable' }
          : { results: opts.searchResults ?? [] }
      ),
    })
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>
  )
}

describe('SearchPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders search input and submit button', () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    expect(screen.getByRole('textbox', { name: /search query/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeTruthy()
  })

  it('loads channels and shows checkboxes', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: mockChannels }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Channel One')).toBeTruthy()
      expect(screen.getByText('Channel Two')).toBeTruthy()
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('shows results after successful search', async () => {
    vi.stubGlobal('fetch', makeFetch({ searchResults: [mockSearchResult] }))
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'machine learning' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText('Test Video Title')).toBeTruthy()
      expect(screen.getByText('A relevant transcript snippet about the topic.')).toBeTruthy()
    })
  })

  it('shows "No matches found" when search returns empty results', async () => {
    vi.stubGlobal('fetch', makeFetch({ searchResults: [] }))
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'obscure topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText(/no matches found/i)).toBeTruthy()
    })
  })

  it('shows error message when search API returns non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetch({ searchOk: false }))
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'anything' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText('Search service unavailable')).toBeTruthy()
    })
  })

  it('passes fromDate and toDate in search request body', async () => {
    const fetchMock = makeFetch({ searchResults: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'test query' },
    })
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2025-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      const searchCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/search')
      expect(searchCall).toBeTruthy()
      const body = JSON.parse(searchCall![1].body as string)
      expect(body.fromDate).toBe('2025-01-01')
      expect(body.toDate).toBe('2025-12-31')
    })
  })

  it('passes selected channelIds in search request body', async () => {
    const fetchMock = makeFetch({ channels: mockChannels, searchResults: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => screen.getByText('Channel One'))
    fireEvent.click(screen.getByRole('checkbox', { name: /channel one/i }))

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      const searchCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/search')
      expect(searchCall).toBeTruthy()
      const body = JSON.parse(searchCall![1].body as string)
      expect(body.channelIds).toEqual(['UCchannel1'])
    })
  })

  it('disables submit button and shows "Searching…" while request is in flight', async () => {
    let resolveSearch!: () => void
    const searchPromise = new Promise<void>(res => { resolveSearch = res })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/channels') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [] }) })
      }
      return searchPromise.then(() => ({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /search query/i }), {
      target: { value: 'test' },
    })
    fireEvent.click(screen.getByRole('button'))

    const btn = screen.getByRole('button')
    expect(btn.textContent).toBe('Searching…')
    expect((btn as HTMLButtonElement).disabled).toBe(true)

    resolveSearch()
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Search'))
  })
})
