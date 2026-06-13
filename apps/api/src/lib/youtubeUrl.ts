const ALLOWED_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com'])
const CHANNEL_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com'])

export interface ChannelInput {
  type: 'handle' | 'id' | 'customUrl'
  value: string
}

export function parseYouTubeChannelInput(input: string): ChannelInput | null {
  if (!input) return null

  // Bare @handle
  if (input.startsWith('@')) {
    const handle = input.slice(1).replace(/\/$/, '')
    return handle ? { type: 'handle', value: handle } : null
  }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return null
  }

  if (!CHANNEL_HOSTS.has(parsed.hostname)) return null

  const path = parsed.pathname.replace(/\/$/, '')

  const atHandle = path.match(/^\/@(.+)$/)
  if (atHandle) return { type: 'handle', value: atHandle[1] }

  const channelId = path.match(/^\/channel\/([^/]+)$/)
  if (channelId) return { type: 'id', value: channelId[1] }

  const cHandle = path.match(/^\/c\/([^/]+)$/)
  if (cHandle) return { type: 'customUrl', value: cHandle[1] }

  return null
}

export function parseYouTubeVideoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return null

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}
