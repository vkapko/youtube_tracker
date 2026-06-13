import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface RecentVideo {
  youtubeVideoId: string
  title: string
  thumbnailUrl: string | null
  transcriptStatus: string
  ingestedAt: string
  channelName: string | null
}

interface FailedJob {
  id: number
  type: string
  payload: Record<string, unknown>
  errorMessage: string | null
  errorCode: string | null
  retryable: boolean | null
  failedAt: string
}

interface DashboardData {
  totalChannels: number
  totalIndexedVideos: number
  videosWithoutTranscripts: number
  totalFailedIngestionJobs: number
  recentlyIngestedVideos: RecentVideo[]
  recentlyFailedJobs: FailedJob[]
}

const STAT_CARD_STYLE: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem',
  minWidth: 130,
  flex: 1,
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [retryingJobIds, setRetryingJobIds] = useState<Set<number>>(new Set())

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard')
      if (!response.ok) throw new Error('Failed to load dashboard')
      setDashboard(await response.json() as DashboardData)
      setError('')
    } catch {
      setError('Failed to load dashboard')
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  async function retryJob(jobId: number, force = false) {
    setRetryingJobIds(current => new Set(current).add(jobId))
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
        ...(force ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) } : {}),
      })
      if (!response.ok) throw new Error('Failed to retry job')
      await loadDashboard()
    } catch {
      setError('Failed to retry job')
    } finally {
      setRetryingJobIds(current => {
        const next = new Set(current)
        next.delete(jobId)
        return next
      })
    }
  }

  function handleForceRetry(jobId: number) {
    if (window.confirm('This failure is not automatically retryable. Force retry after correcting the environment?')) {
      void retryJob(jobId, true)
    }
  }

  useEffect(() => {
    const interval = setInterval(() => {
      void loadDashboard()
    }, 30_000)
    return () => clearInterval(interval)
  }, [loadDashboard])

  if (!dashboard) {
    return <p style={{ margin: '2rem' }}>{error || 'Loading…'}</p>
  }

  const stats = [
    ['Tracked channels', dashboard.totalChannels],
    ['Indexed videos', dashboard.totalIndexedVideos],
    ['Without transcripts', dashboard.videosWithoutTranscripts],
    ['Failed jobs', dashboard.totalFailedIngestionJobs],
  ] as const

  return (
    <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <nav style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', fontSize: '0.9rem' }}>
        <Link to="/">Add Video</Link>
        <Link to="/channels">Channels</Link>
        <Link to="/search">Search</Link>
        <Link to="/chat">Chat</Link>
      </nav>

      <h1>Dashboard</h1>
      {error && <p style={{ color: '#c62828' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {stats.map(([label, value]) => (
          <section key={label} style={STAT_CARD_STYLE}>
            <div style={{ color: '#666', fontSize: '0.85rem' }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>{value}</div>
          </section>
        ))}
      </div>

      <h2>Recently ingested</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
        {dashboard.recentlyIngestedVideos.map(video => (
          <article key={video.youtubeVideoId} style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
            {video.thumbnailUrl && (
              <img src={video.thumbnailUrl} alt="" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />
            )}
            <div style={{ padding: '0.75rem' }}>
              <Link to={`/videos/${video.youtubeVideoId}`} style={{ fontWeight: 600 }}>
                {video.title}
              </Link>
              {video.channelName && <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.25rem' }}>{video.channelName}</div>}
            </div>
          </article>
        ))}
      </div>

      <h2 style={{ marginTop: '2rem' }}>Failed jobs</h2>
      {dashboard.recentlyFailedJobs.map(job => (
        <div key={job.id} style={{ border: '1px solid #f0c7c7', borderRadius: 8, padding: '0.75rem', marginBottom: '0.6rem' }}>
          <div style={{ fontWeight: 600 }}>{job.type}</div>
          <p style={{ color: '#c62828', margin: '0.35rem 0' }}>{job.errorMessage ?? 'Ingestion failed'}</p>
          {job.errorCode && (
            <p style={{ color: '#888', fontSize: '0.8rem', margin: '0.25rem 0' }}>Error code: {job.errorCode}</p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={() => void retryJob(job.id)}
              disabled={retryingJobIds.has(job.id) || job.retryable === false}
            >
              {retryingJobIds.has(job.id) ? 'Retrying…' : 'Retry'}
            </button>
            {job.retryable === false && (
              <button
                type="button"
                onClick={() => handleForceRetry(job.id)}
                disabled={retryingJobIds.has(job.id)}
              >
                Force retry
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
