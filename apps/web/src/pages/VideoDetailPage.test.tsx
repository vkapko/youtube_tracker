import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VideoDetailPage from './VideoDetailPage'

vi.mock('../components/TranscriptViewer', () => ({ default: () => <div /> }))
vi.mock('../components/ManualTranscriptForm', () => ({ default: () => <div /> }))

const baseVideo = {
  youtube_video_id: 'test123',
  title: 'Test Video',
  channel_name: 'Test Channel',
  description: 'A description.',
  duration_seconds: 300,
  published_at: '2025-01-15T00:00:00Z',
  thumbnail_url: '',
  transcript_status: 'pending',
  summary_status: 'pending',
}

type FetchOpts = {
  summary?: object | null
  retryResult?: object
  retryOk?: boolean
  retryDelay?: Promise<void>
}

function makeFetch({
  summary = { status: 'pending' },
  retryResult = { status: 'available', shortSummary: 'Retry succeeded' },
  retryOk = true,
  retryDelay,
}: FetchOpts = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/videos/test123') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseVideo) })
    }
    if (url === '/api/videos/test123/summaries/retry') {
      const result = { ok: retryOk, json: () => Promise.resolve(retryResult) }
      return retryDelay ? retryDelay.then(() => result) : Promise.resolve(result)
    }
    if (url === '/api/videos/test123/summaries') {
      if (summary === null) return Promise.reject(new Error('network'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summary) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ segments: [] }) })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/videos/test123']}>
      <Routes>
        <Route path="/videos/:youtubeVideoId" element={<VideoDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VideoDetailPage — summary display', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows shortSummary and keyTopics when summary is available', async () => {
    vi.stubGlobal('fetch', makeFetch({
      summary: {
        status: 'available',
        shortSummary: 'Great video about AI.',
        keyTopics: ['machine learning', 'neural networks'],
      },
    }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Great video about AI.')).toBeTruthy()
      expect(screen.getByText('machine learning')).toBeTruthy()
      expect(screen.getByText('neural networks')).toBeTruthy()
    })
  })

  it('shows pending message when summary status is pending', async () => {
    vi.stubGlobal('fetch', makeFetch({ summary: { status: 'pending' } }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/summarization is pending/i)).toBeTruthy())
  })

  it('shows failed message and retry button when summary status is failed', async () => {
    vi.stubGlobal('fetch', makeFetch({ summary: { status: 'failed' } }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/summarization failed/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /retry summary/i })).toBeTruthy()
    })
  })

  it('does not show summary section when summary fetch throws', async () => {
    vi.stubGlobal('fetch', makeFetch({ summary: null }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test Video')).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull()
  })
})

describe('VideoDetailPage — retry behavior', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls retry endpoint and updates summary to available on success', async () => {
    vi.stubGlobal('fetch', makeFetch({
      summary: { status: 'failed' },
      retryResult: {
        status: 'available',
        shortSummary: 'Retry produced this summary.',
        keyTopics: ['topic1'],
      },
    }))
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /retry summary/i }))
    fireEvent.click(screen.getByRole('button', { name: /retry summary/i }))
    await waitFor(() => expect(screen.getByText('Retry produced this summary.')).toBeTruthy())
  })

  it('shows "Retrying…" and disables the button while retry is in flight', async () => {
    let resolveRetry!: () => void
    const retryDelay = new Promise<void>(res => { resolveRetry = res })
    vi.stubGlobal('fetch', makeFetch({ summary: { status: 'failed' }, retryDelay }))
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /retry summary/i }))

    fireEvent.click(screen.getByRole('button', { name: /retry summary/i }))

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /retrying/i })
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    })

    resolveRetry()
    await waitFor(() => expect(screen.queryByRole('button', { name: /retrying/i })).toBeNull())
  })

  it('shows failed state when retry endpoint returns non-ok', async () => {
    vi.stubGlobal('fetch', makeFetch({
      summary: { status: 'failed' },
      retryOk: false,
      retryResult: { status: 'failed' },
    }))
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /retry summary/i }))
    fireEvent.click(screen.getByRole('button', { name: /retry summary/i }))
    await waitFor(() => {
      expect(screen.getByText(/summarization failed/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /retry summary/i })).toBeTruthy()
    })
  })
})
