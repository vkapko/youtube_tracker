import { useRef, useState } from 'react'

interface Props {
  videoId: string
  onSaved: () => void
}

export default function ManualTranscriptForm({ videoId, onSaved }: Props) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    setText(content)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/videos/${videoId}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#555', fontSize: '0.9rem' }}>
        Paste a transcript or upload a .txt file:
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ padding: '0.3rem 0.75rem', cursor: 'pointer' }}
        >
          Choose file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {text && <span style={{ fontSize: '0.85rem', color: '#555' }}>{text.length.toLocaleString()} chars loaded</span>}
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste transcript here…"
        rows={8}
        style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.5rem' }}
      />
      {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}
      <button
        type="submit"
        disabled={saving || !text.trim()}
        style={{ alignSelf: 'flex-start', padding: '0.4rem 1rem', cursor: 'pointer' }}
      >
        {saving ? 'Saving…' : 'Save transcript'}
      </button>
    </form>
  )
}
