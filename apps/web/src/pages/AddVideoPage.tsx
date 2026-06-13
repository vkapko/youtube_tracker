import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface JobState {
  jobId: number
  youtubeVideoId: string
  status: JobStatus | null
  stage: string | null
  errorMessage: string | null
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued — waiting to start',
  running: 'Processing…',
  completed: 'Done',
  failed: 'Failed',
}

const STAGE_LABEL: Record<string, string> = {
  fetching_metadata: 'Fetching video info…',
  fetching_transcript: 'Fetching transcript…',
  fetching_videos: 'Fetching channel videos…',
  indexing: 'Indexing transcript…',
  summarising: 'Generating summary…',
}

export default function AddVideoPage() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<JobState | null>(null)
  const navigate = useNavigate()

  async function startIngest(videoUrl: string) {
    setError('')
    setSubmitting(true)
    setJob(null)
    try {
      const res = await fetch('/api/videos/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl }),
      })
      const data = await res.json() as { error?: string; jobId?: number; youtubeVideoId?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        return
      }
      setJob({ jobId: data.jobId!, youtubeVideoId: data.youtubeVideoId!, status: 'queued', stage: null, errorMessage: null })
    } catch {
      setError('Failed to connect to API')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await startIngest(url)
  }

  // Poll job status
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.jobId}`)
        if (!res.ok) return
        const data = await res.json() as { status: JobStatus; stage: string | null; error_message: string | null }
        setJob(prev => prev ? { ...prev, status: data.status, stage: data.stage, errorMessage: data.error_message } : prev)
      } catch {
        // keep polling
      }
    }, 1000)
    return () => clearInterval(id)
  }, [job?.jobId, job?.status])

  // Navigate when done
  useEffect(() => {
    if (job?.status === 'completed') {
      navigate(`/videos/${job.youtubeVideoId}`)
    }
  }, [job?.status])

  if (job && job.status !== null) {
    const isFailed = job.status === 'failed'
    const progressLabel =
      job.status === 'running' && job.stage && STAGE_LABEL[job.stage]
        ? STAGE_LABEL[job.stage]
        : STATUS_LABEL[job.status]

    return (
      <div style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Adding Video</h1>
        <p>{progressLabel}</p>
        {isFailed && (
          <div>
            <p style={{ color: 'red' }}>{job.errorMessage ?? 'Ingestion failed'}</p>
            <button onClick={() => startIngest(url)}>Retry</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
      <nav style={{ marginBottom: '1.5rem', fontSize: '0.9rem', display: 'flex', gap: '1rem' }}>
        <Link to="/dashboard" style={{ color: '#1a73e8' }}>Dashboard</Link>
        <Link to="/search" style={{ color: '#1a73e8' }}>Search</Link>
        <Link to="/channels" style={{ color: '#1a73e8' }}>Channels</Link>
      </nav>
      <h1>Add Video</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="url">YouTube URL</label>
        <input
          id="url"
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={{ display: 'block', width: '100%', margin: '0.5rem 0', padding: '0.5rem' }}
        />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={submitting || !url.trim()}>
          {submitting ? 'Adding…' : 'Add Video'}
        </button>
      </form>
    </div>
  )
}
