import { useState, useEffect, FormEvent } from 'react'
import { Link } from 'react-router-dom'

interface Channel {
  id: number
  youtube_channel_id: string
  name: string
  handle: string | null
  thumbnail_url: string | null
  last_checked_at: string | null
  indexed_video_count: number
  failed_transcript_count: number
}

type SyncStatus = 'queued' | 'running' | 'completed' | 'failed'
type SyncState = { jobId: number; status: SyncStatus } | null

const CARD_STYLE: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem',
  display: 'flex',
  gap: '1rem',
  alignItems: 'flex-start',
}

const STAGE_LABEL: Record<string, string> = {
  fetching_videos: 'Fetching channel videos…',
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addJobId, setAddJobId] = useState<number | null>(null)
  const [syncStates, setSyncStates] = useState<Record<number, SyncState>>({})

  function fetchChannels() {
    fetch('/api/channels')
      .then(r => r.json())
      .then((data: { channels: Channel[] }) => {
        setChannels(data.channels)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchChannels() }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true)
    setAddError('')
    setAddJobId(null)
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json() as { error?: string; jobId?: number; channelId?: number }
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add channel')
        return
      }
      setUrl('')
      setAddJobId(data.jobId!)
      fetchChannels()
    } catch {
      setAddError('Failed to connect to API')
    } finally {
      setAdding(false)
    }
  }

  async function handleSync(channel: Channel) {
    setSyncStates(prev => ({ ...prev, [channel.id]: { jobId: -1, status: 'queued' } }))
    try {
      const res = await fetch(`/api/channels/${channel.id}/sync`, { method: 'POST' })
      const data = await res.json() as { jobId?: number; error?: string }
      if (!res.ok || !data.jobId) {
        setSyncStates(prev => ({ ...prev, [channel.id]: null }))
        return
      }
      setSyncStates(prev => ({ ...prev, [channel.id]: { jobId: data.jobId!, status: 'queued' } }))
    } catch {
      setSyncStates(prev => ({ ...prev, [channel.id]: null }))
    }
  }

  // Poll active sync jobs
  useEffect(() => {
    const activeChannelIds = Object.entries(syncStates)
      .filter(([, s]) => s && s.status !== 'completed' && s.status !== 'failed' && s.jobId !== -1)
      .map(([id]) => Number(id))

    if (activeChannelIds.length === 0 && !addJobId) return

    const id = setInterval(async () => {
      for (const channelId of activeChannelIds) {
        const state = syncStates[channelId]
        if (!state || state.jobId === -1) continue
        try {
          const res = await fetch(`/api/jobs/${state.jobId}`)
          if (!res.ok) continue
          const job = await res.json() as { status: string; stage: string | null }
          setSyncStates(prev => ({
            ...prev,
            [channelId]: { ...prev[channelId]!, status: job.status as SyncStatus },
          }))
          if (job.status === 'completed') fetchChannels()
        } catch { /* keep polling */ }
      }

      if (addJobId) {
        try {
          const res = await fetch(`/api/jobs/${addJobId}`)
          if (!res.ok) return
          const job = await res.json() as { status: string }
          if (job.status === 'completed' || job.status === 'failed') {
            setAddJobId(null)
            fetchChannels()
          }
        } catch { /* keep polling */ }
      }
    }, 1500)

    return () => clearInterval(id)
  }, [syncStates, addJobId])

  return (
    <div style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
      <nav style={{ marginBottom: '1.5rem', fontSize: '0.9rem', display: 'flex', gap: '1rem' }}>
        <Link to="/" style={{ color: '#1a73e8' }}>Add Video</Link>
        <Link to="/search" style={{ color: '#1a73e8' }}>Search</Link>
        <Link to="/chat" style={{ color: '#1a73e8' }}>Chat</Link>
      </nav>

      <h1>Channels</h1>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="@handle or youtube.com/channel/…"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={adding || !url.trim()}>
          {adding ? 'Adding…' : 'Add Channel'}
        </button>
      </form>
      {addError && <p style={{ color: 'red', marginTop: '-1.5rem', marginBottom: '1rem' }}>{addError}</p>}
      {addJobId && <p style={{ color: '#888', marginTop: '-1.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>Syncing channel uploads…</p>}

      {loading && <p>Loading…</p>}

      {!loading && channels.length === 0 && (
        <p style={{ color: '#888' }}>No channels tracked yet. Add one above.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {channels.map(ch => {
          const sync = syncStates[ch.id]
          const isSyncing = sync && sync.status !== 'completed' && sync.status !== 'failed'

          return (
            <div key={ch.id} style={CARD_STYLE}>
              {ch.thumbnail_url && (
                <img
                  src={ch.thumbnail_url}
                  alt={ch.name}
                  style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Link
                      to={`/channels/${ch.id}`}
                      style={{ fontWeight: 600, fontSize: '1rem', color: '#1a73e8', textDecoration: 'none' }}
                    >
                      {ch.name}
                    </Link>
                    {ch.handle && (
                      <span style={{ color: '#888', fontSize: '0.85rem', marginLeft: '0.4rem' }}>@{ch.handle}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleSync(ch)}
                    disabled={!!isSyncing}
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', cursor: isSyncing ? 'not-allowed' : 'pointer', opacity: isSyncing ? 0.6 : 1 }}
                  >
                    {isSyncing ? (sync?.status === 'running' ? STAGE_LABEL['fetching_videos'] ?? 'Syncing…' : 'Syncing…') : 'Sync now'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.4rem', fontSize: '0.85rem', color: '#555' }}>
                  <span>{ch.indexed_video_count} indexed</span>
                  {ch.failed_transcript_count > 0 && (
                    <span style={{ color: '#c62828' }}>{ch.failed_transcript_count} failed</span>
                  )}
                  {ch.last_checked_at && (
                    <span>Last synced {new Date(ch.last_checked_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
