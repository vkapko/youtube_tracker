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

export async function fetchChannelRecentVideoIds(channelId: string, maxResults = 50): Promise<ChannelVideoRef[]> {
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

  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${apiKey}`
  )
  if (!playlistRes.ok) throw new Error(`YouTube API responded with ${playlistRes.status}`)

  const playlistData = await playlistRes.json() as {
    items?: Array<{ snippet: { publishedAt: string; resourceId: { videoId: string } } }>
  }

  return (playlistData.items ?? []).map(item => ({
    videoId: item.snippet.resourceId.videoId,
    publishedAt: item.snippet.publishedAt,
  }))
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}
