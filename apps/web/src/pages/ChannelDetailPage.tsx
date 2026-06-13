import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

interface Channel {
  id: number
  youtube_channel_id: string
  name: string
  handle: string | null
  thumbnail_url: string | null
  last_checked_at: string | null
}

interface Video {
  youtube_video_id: string
  title: string
  transcript_status: string
  summary_status: string
  published_at: string | null
  thumbnail_url: string | null
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  available:   { background: '#e8f5e9', color: '#2e7d32' },
  pending:     { background: '#fff8e1', color: '#f57f17' },
  unavailable: { background: '#fafafa', color: '#757575' },
  failed:      { background: '#fce4ec', color: '#c62828' },
}

function Badge({ status }: { status: string }) {
  return (
    <span style={{ ...(STATUS_STYLE[status] ?? {}), padding: '0.1rem 0.45rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 500 }}>
      {status}
    </span>
  )
}

export default function ChannelDetailPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncJobId, setSyncJobId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!channelId) return
    fetch(`/api/channels/${channelId}`)
      .then(r => r.json())
      .then((data: { channel: Channel; videos: Video[]; error?: string }) => {
        if (data.error) { setError(data.error); return }
        setChannel(data.channel)
        setVideos(data.videos)
      })
      .catch(() => setError('Failed to load channel'))
  }, [channelId])

  async function handleSync() {
    if (!channelId || syncing) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/channels/${channelId}/sync`, { method: 'POST' })
      const data = await res.json() as { jobId?: number; error?: string }
      if (res.ok && data.jobId) {
        setSyncJobId(data.jobId)
      } else {
        setSyncing(false)
      }
    } catch {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!syncJobId) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${syncJobId}`)
        if (!res.ok) return
        const job = await res.json() as { status: string }
        if (job.status === 'completed' || job.status === 'failed') {
          setSyncing(false)
          setSyncJobId(null)
          if (!channelId) return
          fetch(`/api/channels/${channelId}`)
            .then(r => r.json())
            .then((data: { channel: Channel; videos: Video[] }) => {
              setChannel(data.channel)
              setVideos(data.videos)
            })
            .catch(() => { /* keep existing data */ })
        }
      } catch { /* keep polling */ }
    }, 1500)
    return () => clearInterval(id)
  }, [syncJobId, channelId])

  if (error) return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <p style={{ color: 'red' }}>{error}</p>
      <Link to="/channels">← Channels</Link>
    </div>
  )

  if (!channel) return <p style={{ margin: '2rem' }}>Loading…</p>

  const indexedCount = videos.filter(v => v.transcript_status === 'available').length
  const failedCount = videos.filter(v => v.transcript_status === 'failed').length

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/channels" style={{ fontSize: '0.9rem', color: '#1a73e8' }}>← Channels</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem', marginBottom: '1.5rem' }}>
        {channel.thumbnail_url && (
          <img
            src={channel.thumbnail_url}
            alt={channel.name}
            style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
          />
        )}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{channel.name}</h1>
          {channel.handle && <p style={{ margin: '0.2rem 0 0', color: '#888', fontSize: '0.9rem' }}>@{channel.handle}</p>}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', fontSize: '0.85rem', color: '#555' }}>
            <span>{indexedCount} indexed</span>
            {failedCount > 0 && <span style={{ color: '#c62828' }}>{failedCount} failed</span>}
            {channel.last_checked_at && (
              <span>Last synced {new Date(channel.last_checked_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{ padding: '0.4rem 0.9rem', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Videos ({videos.length})</h2>

      {videos.length === 0 && (
        <p style={{ color: '#888' }}>No videos yet. Sync the channel to fetch uploads.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {videos.map(v => (
          <div
            key={v.youtube_video_id}
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.6rem', border: '1px solid #eee', borderRadius: 6 }}
          >
            {v.thumbnail_url && (
              <img
                src={v.thumbnail_url}
                alt={v.title}
                style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link
                to={`/videos/${v.youtube_video_id}`}
                style={{ fontWeight: 500, color: '#1a73e8', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {v.title}
              </Link>
              {v.published_at && (
                <span style={{ fontSize: '0.8rem', color: '#888' }}>
                  {new Date(v.published_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <Badge status={v.transcript_status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
