export interface ChannelMetadata {
  youtubeChannelId: string
  title: string
  handle: string | null
  thumbnailUrl: string
}

export class ChannelNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChannelNotFoundError'
  }
}

export async function resolveChannel(input: { type: 'handle' | 'id' | 'customUrl'; value: string }): Promise<ChannelMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set')

  let params: string[]
  if (input.type === 'id') {
    params = [`id=${input.value}`]
  } else if (input.type === 'handle') {
    params = [`forHandle=${encodeURIComponent(input.value)}`]
  } else {
    // Legacy /c/ custom URL: the API has no direct lookup. Try forHandle (works when slug ==
    // handle) then forUsername (covers the old /user/ namespace that many /c/ slugs map to).
    params = [
      `forHandle=${encodeURIComponent(input.value)}`,
      `forUsername=${encodeURIComponent(input.value)}`,
    ]
  }

  type ChannelItem = { id: string; snippet: { title: string; customUrl?: string; thumbnails: Record<string, { url: string }> } }
  type ChannelResponse = { items?: ChannelItem[] }

  let item: ChannelItem | undefined
  for (const param of params) {
    item = await fetchChannelItem(param, apiKey)
    if (item) break
  }

  if (!item && input.type === 'customUrl') {
    const channelId = await resolveLegacyCustomUrl(input.value)
    if (channelId) item = await fetchChannelItem(`id=${channelId}`, apiKey)
  }

  if (!item) {
    if (input.type === 'customUrl') {
      throw new ChannelNotFoundError(
        `Could not resolve legacy custom URL "/c/${input.value}". ` +
          `Try using the channel's @handle URL (e.g. https://youtube.com/@${input.value}) instead.`
      )
    }
    throw new ChannelNotFoundError(`No channel found for: ${input.value}`)
  }

  const { snippet } = item
  const thumbnailUrl =
    snippet.thumbnails.high?.url ?? snippet.thumbnails.default?.url ?? ''
  const handle = snippet.customUrl ? snippet.customUrl.replace(/^@/, '') : null

  return { youtubeChannelId: item.id, title: snippet.title, handle, thumbnailUrl }

  async function fetchChannelItem(param: string, key: string): Promise<ChannelItem | undefined> {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&${param}&key=${key}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`YouTube API responded with ${response.status}`)
    const data = (await response.json()) as ChannelResponse
    return data.items?.[0]
  }
}

async function resolveLegacyCustomUrl(slug: string): Promise<string | null> {
  const response = await fetch(`https://www.youtube.com/c/${encodeURIComponent(slug)}`)
  if (!response.ok) return null

  const redirectedId = new URL(response.url).pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1]
  if (redirectedId) return redirectedId

  const html = await response.text()
  const patterns = [
    /itemprop=["']channelId["'][^>]*content=["'](UC[A-Za-z0-9_-]{22})["']/,
    /content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*itemprop=["']channelId["']/,
    /["'](?:externalId|channelId)["']\s*:\s*["'](UC[A-Za-z0-9_-]{22})["']/,
    /\/channel\/(UC[A-Za-z0-9_-]{22})/,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return null
}

export interface VideoMetadata {
  youtubeVideoId: string
  channelId: string
  channelTitle: string
  title: string
  description: string
  publishedAt: string
  durationSeconds: number
  thumbnailUrl: string
  hasCaptions: boolean
}

export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set')

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`YouTube API responded with ${response.status}`)

  const data = (await response.json()) as {
    items?: Array<{
      snippet: {
        title: string
        description: string
        channelId: string
        channelTitle: string
        publishedAt: string
        thumbnails: Record<string, { url: string }>
      }
      contentDetails: { duration: string; caption: string }
    }>
  }

  const item = data.items?.[0]
  if (!item) throw new Error(`No video found for id: ${videoId}`)

  const { snippet, contentDetails } = item
  const thumbnailUrl =
    snippet.thumbnails.maxres?.url ??
    snippet.thumbnails.high?.url ??
    snippet.thumbnails.default?.url ??
    ''

  return {
    youtubeVideoId: videoId,
    channelId: snippet.channelId,
    channelTitle: snippet.channelTitle,
    title: snippet.title,
    description: snippet.description,
    publishedAt: snippet.publishedAt,
    durationSeconds: parseDuration(contentDetails.duration),
    thumbnailUrl,
    hasCaptions: contentDetails.caption === 'true',
  }
}

export interface ChannelVideoRef {
  videoId: string
  publishedAt: string
}

export async function fetchChannelRecentVideoIds(channelId: string, maxTotal = Infinity): Promise<ChannelVideoRef[]> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set')

  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
  )
  if (!channelRes.ok) throw new Error(`YouTube API responded with ${channelRes.status}`)

  const channelData = await channelRes.json() as {
    items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }>
  }
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsPlaylistId) throw new Error(`No uploads playlist found for channel: ${channelId}`)

  const results: ChannelVideoRef[] = []
  let pageToken: string | undefined

  do {
    const pageSize = Math.min(50, isFinite(maxTotal) ? maxTotal - results.length : 50)
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: String(pageSize),
      key: apiKey,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`
    )
    if (!playlistRes.ok) throw new Error(`YouTube API responded with ${playlistRes.status}`)

    const playlistData = await playlistRes.json() as {
      nextPageToken?: string
      items?: Array<{ snippet: { publishedAt: string; resourceId: { videoId: string } } }>
    }

    for (const item of playlistData.items ?? []) {
      results.push({
        videoId: item.snippet.resourceId.videoId,
        publishedAt: item.snippet.publishedAt,
      })
    }

    pageToken = playlistData.nextPageToken
  } while (pageToken && results.length < maxTotal)

  return results
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}
