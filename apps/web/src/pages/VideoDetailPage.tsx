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

interface Segment {
  startSeconds?: number
  text: string
}

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

export default function VideoDetailPage() {
  const { youtubeVideoId } = useParams<{ youtubeVideoId: string }>()
  const [video, setVideo] = useState<Video | null>(null)
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [error, setError] = useState('')

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

  useEffect(() => { fetchVideo() }, [fetchVideo])

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
              onSaved={() => { setVideo(null); setSegments(null); fetchVideo() }}
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
