import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import TranscriptViewer from '../components/TranscriptViewer'
import ManualTranscriptForm from '../components/ManualTranscriptForm'

interface Video {
  youtube_video_id: string
  title: string
  channel_name: string | null
  description: string
  duration_seconds: number
  published_at: string
  thumbnail_url: string
  transcript_status: 'pending' | 'available' | 'unavailable' | 'failed'
  summary_status: string
}

interface Summary {
  status: string
  shortSummary?: string
  keyTopics?: string[]
}

interface Segment {
  startSeconds?: number
  text: string
}

type LazySummaryType = 'detailed_summary' | 'action_items' | 'technical_terms' | 'notable_quotes'

interface LazySummaryState {
  content: string | string[] | null
  loading: boolean
}

const LAZY_SUMMARY_LABELS: Record<LazySummaryType, string> = {
  detailed_summary: 'Detailed Summary',
  action_items: 'Action Items',
  technical_terms: 'Technical Terms',
  notable_quotes: 'Notable Quotes',
}

const LAZY_SUMMARY_TYPES: LazySummaryType[] = [
  'detailed_summary',
  'action_items',
  'technical_terms',
  'notable_quotes',
]

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  available:   { background: '#e8f5e9', color: '#2e7d32' },
  pending:     { background: '#fff8e1', color: '#f57f17' },
  unavailable: { background: '#fafafa', color: '#757575' },
  failed:      { background: '#fce4ec', color: '#c62828' },
}

function TranscriptStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? {}
  return (
    <span style={{ ...style, padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.8rem', fontWeight: 500 }}>
      {status}
    </span>
  )
}

const BTN_STYLE: React.CSSProperties = {
  padding: '0.35rem 0.8rem',
  fontSize: '0.85rem',
  cursor: 'pointer',
}

const BTN_DISABLED_STYLE: React.CSSProperties = {
  ...BTN_STYLE,
  cursor: 'not-allowed',
  opacity: 0.6,
}

export default function VideoDetailPage() {
  const { youtubeVideoId } = useParams<{ youtubeVideoId: string }>()
  const [video, setVideo] = useState<Video | null>(null)
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')

  const [lazySummaries, setLazySummaries] = useState<Record<LazySummaryType, LazySummaryState>>(
    () => Object.fromEntries(
      LAZY_SUMMARY_TYPES.map(t => [t, { content: null, loading: false }])
    ) as Record<LazySummaryType, LazySummaryState>
  )

  const fetchVideo = useCallback(() => {
    if (!youtubeVideoId) return
    fetch(`/api/videos/${youtubeVideoId}`)
      .then(r => r.json())
      .then((data: Video & { error?: string }) => {
        if (data.error) setError(data.error)
        else setVideo(data)
      })
      .catch(() => setError('Failed to load video'))
  }, [youtubeVideoId])

  const fetchSummary = useCallback(() => {
    if (!youtubeVideoId) return
    fetch(`/api/videos/${youtubeVideoId}/summaries`)
      .then(r => r.json())
      .then((data: Summary) => setSummary(data))
      .catch(() => {/* summary simply won't render */})
  }, [youtubeVideoId])

  const retrySummary = useCallback(async () => {
    if (!youtubeVideoId || retrying) return
    setRetrying(true)
    try {
      const r = await fetch(`/api/videos/${youtubeVideoId}/summaries/retry`, { method: 'POST' })
      const data = await r.json()
      setSummary(r.ok ? data : { status: 'failed' })
    } catch {
      setSummary({ status: 'failed' })
    } finally {
      setRetrying(false)
    }
  }, [youtubeVideoId, retrying])

  const fetchLazySummary = useCallback(async (type: LazySummaryType) => {
    if (!youtubeVideoId) return
    setLazySummaries(prev => ({ ...prev, [type]: { ...prev[type], loading: true } }))
    try {
      const r = await fetch(`/api/videos/${youtubeVideoId}/summary/${type}`)
      if (r.ok) {
        const data = await r.json()
        setLazySummaries(prev => ({ ...prev, [type]: { content: data.content, loading: false } }))
      } else {
        setLazySummaries(prev => ({ ...prev, [type]: { content: null, loading: false } }))
      }
    } catch {
      setLazySummaries(prev => ({ ...prev, [type]: { content: null, loading: false } }))
    }
  }, [youtubeVideoId])

  const regenerateLazySummary = useCallback(async (type: LazySummaryType) => {
    if (!youtubeVideoId) return
    setLazySummaries(prev => ({ ...prev, [type]: { ...prev[type], loading: true } }))
    try {
      const r = await fetch(`/api/videos/${youtubeVideoId}/summary/${type}`, { method: 'POST' })
      if (r.ok) {
        const data = await r.json()
        setLazySummaries(prev => ({ ...prev, [type]: { content: data.content, loading: false } }))
      } else {
        setLazySummaries(prev => ({ ...prev, [type]: { content: prev[type].content, loading: false } }))
      }
    } catch {
      setLazySummaries(prev => ({ ...prev, [type]: { content: prev[type].content, loading: false } }))
    }
  }, [youtubeVideoId])

  useEffect(() => { fetchVideo() }, [fetchVideo])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  useEffect(() => {
    if (!youtubeVideoId) return
    LAZY_SUMMARY_TYPES.forEach(type => {
      fetch(`/api/videos/${youtubeVideoId}/summary/${type}?cacheOnly=true`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.content != null) {
            setLazySummaries(prev => ({ ...prev, [type]: { content: data.content, loading: false } }))
          }
        })
        .catch(() => {/* cached summaries simply won't pre-populate */})
    })
  }, [youtubeVideoId])

  useEffect(() => {
    if (!video || video.transcript_status !== 'available') return
    fetch(`/api/videos/${video.youtube_video_id}/transcript`)
      .then(r => r.json())
      .then((data: { segments?: Segment[]; error?: string }) => {
        if (data.segments) setSegments(data.segments)
      })
      .catch(() => {/* viewer simply won't render */})
  }, [video])

  if (error) return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <p style={{ color: 'red' }}>{error}</p>
      <Link to="/">← Add a video</Link>
    </div>
  )

  if (!video) return <p style={{ margin: '2rem' }}>Loading…</p>

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/" style={{ fontSize: '0.9rem' }}>← Add another video</Link>
      <h1 style={{ marginTop: '0.5rem' }}>{video.title}</h1>
      <div style={{ display: 'flex', gap: '1.5rem', color: '#666', marginBottom: '1rem' }}>
        {video.channel_name && <span>{video.channel_name}</span>}
        <span>Published: {new Date(video.published_at).toLocaleDateString()}</span>
        <span>Duration: {formatDuration(video.duration_seconds)}</span>
      </div>
      {video.thumbnail_url && (
        <img
          src={video.thumbnail_url}
          alt={video.title}
          style={{ width: '100%', display: 'block', marginBottom: '1rem', borderRadius: 4 }}
        />
      )}
      <iframe
        width="100%"
        style={{ aspectRatio: '16/9', border: 'none', display: 'block', marginBottom: '1rem' }}
        src={`https://www.youtube.com/embed/${youtubeVideoId}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={video.title}
      />
      <p style={{ whiteSpace: 'pre-line', color: '#444' }}>{video.description}</p>

      {summary && (
        <section style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Summary</h2>
            <TranscriptStatusBadge status={summary.status} />
          </div>

          {summary.status === 'available' && (
            <>
              <p style={{ margin: '0 0 0.75rem', color: '#333' }}>{summary.shortSummary}</p>
              {summary.keyTopics && summary.keyTopics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {summary.keyTopics.map(topic => (
                    <span
                      key={topic}
                      style={{
                        background: '#e3f2fd',
                        color: '#1565c0',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 12,
                        fontSize: '0.8rem',
                      }}
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {summary.status === 'failed' && (
            <div>
              <p style={{ color: '#c62828', fontSize: '0.9rem', margin: '0 0 0.5rem' }}>
                Summarization failed.
              </p>
              <button
                onClick={retrySummary}
                disabled={retrying}
                style={retrying ? BTN_DISABLED_STYLE : BTN_STYLE}
              >
                {retrying ? 'Retrying…' : 'Retry Summary'}
              </button>
            </div>
          )}

          {summary.status === 'pending' && (
            <div>
              <p style={{ color: '#777', fontSize: '0.9rem', margin: '0 0 0.5rem' }}>
                Summarization is pending.
              </p>
              {video?.transcript_status === 'available' && (
                <button
                  onClick={retrySummary}
                  disabled={retrying}
                  style={retrying ? BTN_DISABLED_STYLE : BTN_STYLE}
                >
                  {retrying ? 'Retrying…' : 'Generate Summary'}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {video.transcript_status === 'available' && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Analysis</h2>
          {LAZY_SUMMARY_TYPES.map(type => {
            const state = lazySummaries[type]
            const label = LAZY_SUMMARY_LABELS[type]
            const wasGenerated = state.content !== null
            const hasContent = wasGenerated && (
              typeof state.content === 'string'
                ? state.content.length > 0
                : (state.content as string[]).length > 0
            )

            return (
              <div
                key={type}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 6,
                  padding: '1rem',
                  marginBottom: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: wasGenerated ? '0.75rem' : 0 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{label}</h3>
                  {state.loading && (
                    <span style={{ fontSize: '0.8rem', color: '#888' }}>Generating…</span>
                  )}
                  {!state.loading && !wasGenerated && (
                    <button
                      onClick={() => fetchLazySummary(type)}
                      style={BTN_STYLE}
                    >
                      Generate
                    </button>
                  )}
                  {!state.loading && wasGenerated && (
                    <button
                      onClick={() => regenerateLazySummary(type)}
                      style={{ ...BTN_STYLE, fontSize: '0.8rem' }}
                    >
                      Regenerate
                    </button>
                  )}
                </div>

                {wasGenerated && !hasContent && (
                  <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>Nothing found.</p>
                )}

                {hasContent && typeof state.content === 'string' && (
                  <p style={{ margin: 0, color: '#333', whiteSpace: 'pre-wrap' }}>{state.content}</p>
                )}

                {hasContent && Array.isArray(state.content) && (
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {(state.content as string[]).map((item, i) => (
                      <li key={i} style={{ color: '#333', marginBottom: '0.25rem' }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      )}

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Transcript</h2>
          <TranscriptStatusBadge status={video.transcript_status} />
        </div>

        {video.transcript_status === 'available' && segments && segments.length > 0 && (
          <TranscriptViewer segments={segments} videoId={video.youtube_video_id} />
        )}

        {(video.transcript_status === 'unavailable' || video.transcript_status === 'failed') && (
          <div>
            {video.transcript_status === 'failed' && (
              <p style={{ color: '#c62828', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Automatic extraction failed. You can paste or upload a transcript manually.
              </p>
            )}
            {video.transcript_status === 'unavailable' && (
              <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
                No captions are available for this video. You can paste or upload a transcript manually.
              </p>
            )}
            <ManualTranscriptForm
              videoId={video.youtube_video_id}
              onSaved={() => { setVideo(null); setSegments(null); fetchVideo(); fetchSummary() }}
            />
          </div>
        )}

        {video.transcript_status === 'pending' && (
          <p style={{ color: '#777', fontSize: '0.9rem' }}>Transcript extraction is pending.</p>
        )}
      </section>
    </div>
  )
}
