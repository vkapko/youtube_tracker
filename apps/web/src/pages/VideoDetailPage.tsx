import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

interface Video {
  youtube_video_id: string
  title: string
  channel_name: string | null
  description: string
  duration_seconds: number
  published_at: string
  thumbnail_url: string
  transcript_status: string
  summary_status: string
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VideoDetailPage() {
  const { youtubeVideoId } = useParams<{ youtubeVideoId: string }>()
  const [video, setVideo] = useState<Video | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!youtubeVideoId) return
    fetch(`/api/videos/${youtubeVideoId}`)
      .then(r => r.json())
      .then((data: Video & { error?: string }) => {
        if (data.error) setError(data.error)
        else setVideo(data)
      })
      .catch(() => setError('Failed to load video'))
  }, [youtubeVideoId])

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
    </div>
  )
}
