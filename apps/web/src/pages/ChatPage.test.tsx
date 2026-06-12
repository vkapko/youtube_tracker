import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChatPage from './ChatPage'

const mockChannels = [
  { id: 1, youtube_channel_id: 'UCchannel1', name: 'Channel One', thumbnail_url: null },
  { id: 2, youtube_channel_id: 'UCchannel2', name: 'Channel Two', thumbnail_url: null },
]

const mockSource = {
  videoId: 'vid1',
  title: 'Test Video',
  timestamp: 60,
  reason: 'excerpt about the topic',
}

function makeSseStream(events: unknown[]): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

type FetchOpts = {
  channels?: unknown
  sseEvents?: unknown[]
  chatOk?: boolean
  chatNetworkError?: boolean
}

function makeFetch(opts: FetchOpts = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/channels') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ channels: opts.channels ?? [] }),
      })
    }
    if (opts.chatNetworkError) {
      return Promise.reject(new Error('Network error'))
    }
    if (opts.chatOk === false) {
      return Promise.resolve({ ok: false, body: null })
    }
    return Promise.resolve({
      ok: true,
      body: makeSseStream(opts.sseEvents ?? [{ type: 'done', sources: [] }]),
    })
  })
}

function renderPage() {
  return render(<ChatPage />)
}

describe('ChatPage', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders question input and send button', () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    expect(screen.getByRole('textbox', { name: /question/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
  })

  it('loads channels on mount and shows a checkbox per channel', async () => {
    vi.stubGlobal('fetch', makeFetch({ channels: mockChannels }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Channel One')).toBeTruthy()
      expect(screen.getByText('Channel Two')).toBeTruthy()
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('shows the question in a user bubble immediately on submit', () => {
    vi.stubGlobal('fetch', makeFetch())
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'What is machine learning?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByText('What is machine learning?')).toBeTruthy()
  })

  it('accumulates tokens and shows the full answer after streaming completes', async () => {
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [
        { type: 'token', text: 'Machine ' },
        { type: 'token', text: 'learning is great.' },
        { type: 'done', sources: [] },
      ],
    }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'What is ML?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      expect(screen.getByText('Machine learning is great.')).toBeTruthy()
    })
  })

  it('shows Sources section and source card after done event with sources', async () => {
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [
        { type: 'token', text: 'Answer [1].' },
        { type: 'done', sources: [mockSource] },
      ],
    }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      expect(screen.getByText('Sources')).toBeTruthy()
      expect(screen.getByText('Test Video')).toBeTruthy()
    })
  })

  it('source link includes video ID and timestamp in YouTube URL', async () => {
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [{ type: 'done', sources: [mockSource] }],
    }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /watch at/i }) as HTMLAnchorElement
      expect(link.href).toContain('v=vid1')
      expect(link.href).toContain('t=60s')
    })
  })

  it('source link omits timestamp param when source timestamp is null', async () => {
    const sourceNoTimestamp = { ...mockSource, timestamp: null }
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [{ type: 'done', sources: [sourceNoTimestamp] }],
    }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /watch on youtube/i }) as HTMLAnchorElement
      expect(link.href).toContain('v=vid1')
      expect(link.href).not.toContain('&t=')
    })
  })

  it('shows error message text when stream emits an error event', async () => {
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [{ type: 'error', message: 'Chroma unavailable' }],
    }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      expect(screen.getByText('Chroma unavailable')).toBeTruthy()
    })
  })

  it('shows "Failed to connect" when fetch returns a non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetch({ chatOk: false }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      expect(screen.getByText('Failed to connect')).toBeTruthy()
    })
  })

  it('shows "Connection failed" when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', makeFetch({ chatNetworkError: true }))
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeTruthy()
    })
  })

  it('shows "…" on the send button and disables the input while the fetch is in flight', async () => {
    let resolveChat!: () => void
    const chatPending = new Promise<void>(res => { resolveChat = res })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/channels') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [] }) })
      }
      return chatPending.then(() => ({
        ok: true,
        body: makeSseStream([{ type: 'done', sources: [] }]),
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('…'))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('textbox', { name: /question/i }) as HTMLInputElement).disabled).toBe(true)

    resolveChat()
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Send'))
  })

  it('preserves all previous messages in chat history as new questions are sent', async () => {
    vi.stubGlobal('fetch', makeFetch({
      sseEvents: [{ type: 'done', sources: [] }],
    }))
    renderPage()

    const input = screen.getByRole('textbox', { name: /question/i })

    fireEvent.change(input, { target: { value: 'First question' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Send'))

    fireEvent.change(input, { target: { value: 'Second question' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Send'))

    expect(screen.getByText('First question')).toBeTruthy()
    expect(screen.getByText('Second question')).toBeTruthy()
  })

  it('sends selected channelIds in the request body', async () => {
    const fetchMock = makeFetch({ channels: mockChannels })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => screen.getByText('Channel One'))
    fireEvent.click(screen.getByRole('checkbox', { name: /channel one/i }))

    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/chat')
      expect(chatCall).toBeTruthy()
      const body = JSON.parse(chatCall![1].body as string)
      expect(body.channelIds).toEqual(['UCchannel1'])
    })
  })

  it('omits channelIds from the request body when no channels are selected', async () => {
    const fetchMock = makeFetch({ channels: mockChannels })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => screen.getByText('Channel One'))

    fireEvent.change(screen.getByRole('textbox', { name: /question/i }), {
      target: { value: 'test?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/chat')
      expect(chatCall).toBeTruthy()
      const body = JSON.parse(chatCall![1].body as string)
      expect(body.channelIds).toBeUndefined()
    })
  })
})
