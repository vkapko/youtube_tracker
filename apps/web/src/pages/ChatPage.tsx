import { useState, useEffect, useRef, FormEvent } from 'react'

interface Channel {
  id: number
  youtube_channel_id: string
  name: string
  thumbnail_url: string | null
}

interface ChatSource {
  videoId: string
  title: string
  timestamp: number | null
  reason: string
}

interface Message {
  id: string
  question: string
  answer: string
  sources: ChatSource[]
  streaming: boolean
  error: string | null
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function SourceCard({ source }: { source: ChatSource }) {
  const youtubeUrl =
    source.timestamp !== null
      ? `https://www.youtube.com/watch?v=${source.videoId}&t=${source.timestamp}s`
      : `https://www.youtube.com/watch?v=${source.videoId}`

  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: '0.6rem 0.75rem',
        fontSize: '0.82rem',
        background: '#fafafa',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: '#333' }}>{source.title}</div>
      {source.timestamp !== null && (
        <div style={{ color: '#666', marginBottom: '0.25rem' }}>
          at {formatTimestamp(source.timestamp)}
        </div>
      )}
      <div
        style={{
          color: '#555',
          marginBottom: '0.4rem',
          fontStyle: 'italic',
          lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        "{source.reason}"
      </div>
      <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8' }}>
        {source.timestamp !== null ? `▶ Watch at ${formatTimestamp(source.timestamp)}` : '▶ Watch on YouTube'}
      </a>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div
        style={{
          background: '#e8f0fe',
          borderRadius: 12,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          alignSelf: 'flex-end',
          maxWidth: '80%',
          marginLeft: 'auto',
        }}
      >
        <p style={{ margin: 0, fontWeight: 500 }}>{message.question}</p>
      </div>

      <div style={{ maxWidth: '85%' }}>
        {message.error ? (
          <p style={{ color: 'red', margin: '0 0 0.5rem' }}>{message.error}</p>
        ) : (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
              color: '#222',
              marginBottom: message.sources.length > 0 ? '0.75rem' : 0,
            }}
          >
            {message.answer}
            {message.streaming && (
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 14,
                  background: '#555',
                  marginLeft: 2,
                  animation: 'blink 1s step-end infinite',
                }}
              />
            )}
          </div>
        )}

        {!message.streaming && message.sources.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.4rem', fontWeight: 500 }}>
              Sources
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {message.sources.map(source => (
                <SourceCard key={`${source.videoId}-${source.timestamp}`} source={source} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type SseEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; sources: ChatSource[] }
  | { type: 'error'; message: string }

async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (chunk.startsWith('data: ')) {
          yield JSON.parse(chunk.slice(6)) as SseEvent
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export default function ChatPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/channels')
      .then(r => r.json())
      .then((data: { channels: Channel[] }) => setChannels(data.channels))
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function toggleChannel(youtubeChannelId: string) {
    setSelectedChannelIds(prev =>
      prev.includes(youtubeChannelId)
        ? prev.filter(id => id !== youtubeChannelId)
        : [...prev, youtubeChannelId]
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || streaming) return

    const id = crypto.randomUUID()
    const newMessage: Message = {
      id,
      question: q,
      answer: '',
      sources: [],
      streaming: true,
      error: null,
    }

    setMessages(prev => [...prev, newMessage])
    setQuestion('')
    setStreaming(true)

    try {
      const body: Record<string, unknown> = { question: q }
      if (selectedChannelIds.length > 0) body.channelIds = selectedChannelIds

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        setMessages(prev =>
          prev.map(m =>
            m.id === id ? { ...m, streaming: false, error: 'Failed to connect' } : m
          )
        )
        return
      }

      for await (const event of readSse(res)) {
        if (event.type === 'token') {
          setMessages(prev =>
            prev.map(m => (m.id === id ? { ...m, answer: m.answer + event.text } : m))
          )
        } else if (event.type === 'done') {
          setMessages(prev =>
            prev.map(m => (m.id === id ? { ...m, streaming: false, sources: event.sources } : m))
          )
          break
        } else if (event.type === 'error') {
          setMessages(prev =>
            prev.map(m =>
              m.id === id ? { ...m, streaming: false, error: event.message } : m
            )
          )
          break
        }
      }
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === id ? { ...m, streaming: false, error: 'Connection failed' } : m
        )
      )
    } finally {
      setStreaming(false)
      setMessages(prev =>
        prev.map(m => (m.id === id ? { ...m, streaming: false } : m))
      )
    }
  }

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      <div style={{ maxWidth: 800, margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column', padding: '0 1rem' }}>
        <div style={{ padding: '1rem 0 0.5rem', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Chat</h1>
            <a href="/dashboard" style={{ fontSize: '0.85rem', color: '#1a73e8' }}>Dashboard</a>
            <a href="/search" style={{ fontSize: '0.85rem', color: '#1a73e8' }}>Search</a>
            <a href="/" style={{ fontSize: '0.85rem', color: '#1a73e8' }}>Add Video</a>
          </div>

          {channels.length > 0 && (
            <fieldset style={{ border: '1px solid #ddd', padding: '0.4rem 0.75rem', borderRadius: 4, margin: 0 }}>
              <legend style={{ fontSize: '0.8rem', fontWeight: 500, color: '#555' }}>
                Channel scope (all channels if none selected)
              </legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {channels.map(ch => (
                  <label
                    key={ch.youtube_channel_id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.82rem', cursor: 'pointer' }}
                  >
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
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 0' }}>
          {messages.length === 0 && (
            <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>
              Ask a question about your indexed videos.
            </p>
          )}
          {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ borderTop: '1px solid #eee', padding: '0.75rem 0 1rem', flexShrink: 0 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              aria-label="Question"
              disabled={streaming}
              style={{
                flex: 1,
                padding: '0.6rem 0.75rem',
                fontSize: '1rem',
                borderRadius: 6,
                border: '1px solid #ccc',
              }}
            />
            <button
              type="submit"
              disabled={streaming || !question.trim()}
              style={{
                padding: '0.6rem 1.25rem',
                fontSize: '1rem',
                borderRadius: 6,
                background: '#1a73e8',
                color: '#fff',
                border: 'none',
                cursor: streaming || !question.trim() ? 'not-allowed' : 'pointer',
                opacity: streaming || !question.trim() ? 0.6 : 1,
              }}
            >
              {streaming ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
