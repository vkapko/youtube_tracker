import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import TranscriptViewer from './TranscriptViewer'

// Capture options passed to useVirtualizer so tests can inspect measureElement
let capturedOptions: Record<string, unknown> = {}

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown>) => {
    capturedOptions = opts
    return {
      getTotalSize: () => (opts.count as number) * 40,
      getVirtualItems: () =>
        Array.from({ length: opts.count as number }, (_, i) => ({
          key: i,
          index: i,
          start: i * 40,
          size: 40,
        })),
      measureElement: vi.fn(),
    }
  },
}))

const segments = [
  { startSeconds: 0, text: 'Hello world' },
  {
    startSeconds: 5,
    text: 'This is a much longer segment that would wrap across multiple lines in a narrow container and previously caused items below it to overlap',
  },
  { text: 'No timestamp segment' },
]

describe('TranscriptViewer — dynamic measurement wiring', () => {
  beforeEach(() => {
    capturedOptions = {}
  })

  it('passes measureElement to useVirtualizer', () => {
    render(<TranscriptViewer segments={segments} videoId="abc123" />)
    expect(typeof capturedOptions.measureElement).toBe('function')
  })

  it('measures element height via getBoundingClientRect', () => {
    render(<TranscriptViewer segments={segments} videoId="abc123" />)
    const measure = capturedOptions.measureElement as (el: Element) => number
    const mockEl = { getBoundingClientRect: () => ({ height: 72 }) } as unknown as Element
    expect(measure(mockEl)).toBe(72)
  })

  it('renders each segment with a data-index attribute', () => {
    const { container } = render(<TranscriptViewer segments={segments} videoId="abc123" />)
    const items = container.querySelectorAll('[data-index]')
    expect(items).toHaveLength(segments.length)
    items.forEach((el, i) => {
      expect(el.getAttribute('data-index')).toBe(String(i))
    })
  })

  it('renders timestamp links that point to the correct YouTube URL', () => {
    const { container } = render(<TranscriptViewer segments={segments} videoId="abc123" />)
    const links = container.querySelectorAll('a')
    // First two segments have timestamps; third does not
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('https://www.youtube.com/watch?v=abc123&t=0s')
    expect(links[1].getAttribute('href')).toBe('https://www.youtube.com/watch?v=abc123&t=5s')
  })
})
