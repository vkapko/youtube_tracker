import { useState, useEffect, FormEvent } from 'react'
import { Link } from 'react-router-dom'

interface Channel {
  id: number
  youtube_channel_id: string
  name: string
  thumbnail_url: string | null
}

interface SearchResult {
  videoId: string
  title: string
  channelName: string
  publishedAt: string
  thumbnailUrl: string | null
  snippet: string
  startSeconds: number | null
  youtubeUrl: string
  score: number
  additionalMatchCount?: number
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid #eee' }}>
      {result.thumbnailUrl && (
        <img
          src={result.thumbnailUrl}
          alt={result.title}
          style={{ width: 160, height: 90, objectFit: 'cover', flexShrink: 0, borderRadius: 4 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          to={`/videos/${result.videoId}`}
          style={{ fontWeight: 600, fontSize: '1rem', color: '#1a73e8', textDecoration: 'none' }}
        >
          {result.title}
        </Link>
        <div style={{ fontSize: '0.8rem', color: '#555', margin: '0.2rem 0' }}>
          {result.channelName} · {formatDate(result.publishedAt)}
        </div>
        <p style={{ margin: '0.4rem 0', fontSize: '0.9rem', color: '#333' }}>{result.snippet}</p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.3rem' }}>
          <a
            href={result.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.8rem', color: '#1a73e8' }}
          >
            {result.startSeconds !== null ? `▶ ${formatTimestamp(result.startSeconds)}` : '▶ Watch on YouTube'}
          </a>
          {result.additionalMatchCount && result.additionalMatchCount > 0 ? (
            <Link
              to={`/videos/${result.videoId}`}
              style={{ fontSize: '0.8rem', color: '#555' }}
            >
              +{result.additionalMatchCount} more match{result.additionalMatchCount > 1 ? 'es' : ''}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/channels')
      .then(r => r.json())
      .then((data: { channels: Channel[] }) => setChannels(data.channels))
      .catch(() => {})
  }, [])

  function toggleChannel(youtubeChannelId: string) {
    setSelectedChannelIds(prev =>
      prev.includes(youtubeChannelId)
        ? prev.filter(id => id !== youtubeChannelId)
        : [...prev, youtubeChannelId]
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError('')
    setResults(null)

    try {
      const body: Record<string, unknown> = { query: query.trim() }
      if (selectedChannelIds.length > 0) body.channelIds = selectedChannelIds
      if (fromDate) body.fromDate = fromDate
      if (toDate) body.toDate = toDate

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { results?: SearchResult[]; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Search failed')
        return
      }
      setResults(data.results ?? [])
    } catch {
      setError('Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <nav style={{ marginBottom: '1.5rem', fontSize: '0.9rem', display: 'flex', gap: '1rem' }}>
        <Link to="/dashboard" style={{ color: '#1a73e8' }}>Dashboard</Link>
        <Link to="/" style={{ color: '#1a73e8' }}>Add Video</Link>
      </nav>

      <h1 style={{ marginBottom: '1rem' }}>Search</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search transcripts…"
            aria-label="Search query"
            style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
          />
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {channels.length > 0 && (
          <fieldset style={{ border: '1px solid #ddd', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: 4 }}>
            <legend style={{ fontSize: '0.85rem', fontWeight: 500 }}>Channels</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {channels.map(ch => (
                <label key={ch.youtube_channel_id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedChannelIds.includes(ch.youtube_channel_id)}
                    onChange={() => toggleChannel(ch.youtube_channel_id)}
                  />
                  {ch.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <label>
            From:{' '}
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              aria-label="From date"
              style={{ padding: '0.25rem' }}
            />
          </label>
          <label>
            To:{' '}
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              aria-label="To date"
              style={{ padding: '0.25rem' }}
            />
          </label>
        </div>
      </form>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {results !== null && results.length === 0 && (
        <p style={{ color: '#555' }}>No matches found.</p>
      )}

      {results !== null && results.length > 0 && (
        <div>
          {results.map(result => (
            <SearchResultCard key={result.videoId} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}
