import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

interface Segment {
  startSeconds?: number
  text: string
}

interface Props {
  segments: Segment[]
  videoId: string
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TranscriptViewer({ segments, videoId }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
    measureElement: el => el.getBoundingClientRect().height,
  })

  return (
    <div
      ref={parentRef}
      style={{ height: 400, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 4 }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(item => {
          const seg = segments[item.index]
          const ts = seg.startSeconds
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: item.start,
                left: 0,
                right: 0,
                display: 'flex',
                gap: '0.75rem',
                padding: '0.25rem 0.75rem',
                alignItems: 'flex-start',
                fontSize: '0.9rem',
              }}
            >
              {ts !== undefined && (
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(ts)}s`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flexShrink: 0, color: '#1976d2', fontFamily: 'monospace', fontSize: '0.8rem' }}
                >
                  {formatTimestamp(ts)}
                </a>
              )}
              <span style={{ color: '#333' }}>{seg.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
