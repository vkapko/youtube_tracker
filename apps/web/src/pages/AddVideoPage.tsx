import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AddVideoPage() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/videos/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json() as { error?: string; youtubeVideoId?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        return
      }
      navigate(`/videos/${data.youtubeVideoId}`)
    } catch {
      setError('Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
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
        <button type="submit" disabled={loading || !url.trim()}>
          {loading ? 'Adding…' : 'Add Video'}
        </button>
      </form>
    </div>
  )
}
