import type BetterSqlite3 from 'better-sqlite3'
import { ChromaService } from './chroma'
import type { ChromaSearchParams } from './chroma'

export interface SearchParams {
  query: string
  channelIds?: string[]
  fromDate?: string
  toDate?: string
  topK?: number
}

export interface SearchResult {
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

type ChromaLike = Pick<ChromaService, 'query'>

interface VideoRow {
  youtube_video_id: string
  title: string
  published_at: string | null
  thumbnail_url: string | null
  channel_name: string
}

const RELEVANCE_THRESHOLD = 0.5
const DEFAULT_TOP_K = 10
const FETCH_MULTIPLIER = 5
const MAX_FETCH = 1000
const MAX_CHUNKS_PER_VIDEO_FALLBACK = 500

export class SearchService {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly chroma: ChromaLike = new ChromaService()
  ) {}

  async search(params: SearchParams): Promise<SearchResult[]> {
    const topK = params.topK ?? DEFAULT_TOP_K

    // First pass: broad fetch for ranking and best-chunk selection.
    // Double nResults until we have topK distinct videos, the collection is
    // exhausted (Chroma returned fewer items than requested), or we hit MAX_FETCH.
    // Without this loop, a single video with many strong chunks can fill the
    // entire fetch window and prevent other matching videos from appearing.
    type Entry = { bestScore: number; bestChunkIdx: number }
    let nResults = topK * FETCH_MULTIPLIER
    let ids: string[] = []
    let documents: (string | null)[] = []
    let metadatas: (Record<string, string | number | boolean> | null)[] = []
    let distances: number[] = []
    const byVideo = new Map<string, Entry>()

    while (true) {
      const chromaResult = await this.chroma.query({
        queryText: params.query,
        nResults,
        channelIds: params.channelIds,
        fromDate: params.fromDate,
        toDate: params.toDate,
      } as ChromaSearchParams)

      ids = chromaResult.ids[0] ?? []
      documents = chromaResult.documents[0] ?? []
      metadatas = chromaResult.metadatas[0] ?? []
      distances = chromaResult.distances[0] ?? []

      byVideo.clear()
      for (let i = 0; i < ids.length; i++) {
        const meta = metadatas[i]
        if (!meta) continue
        const videoId = meta.videoId as string
        const score = 1 - (distances[i] ?? 1)
        const existing = byVideo.get(videoId)
        if (!existing || score > existing.bestScore) {
          byVideo.set(videoId, { bestScore: score, bestChunkIdx: i })
        }
      }

      // ids.length < nResults means the collection has no more results to give
      if (byVideo.size >= topK || ids.length < nResults || nResults >= MAX_FETCH) break
      nResults = Math.min(nResults * 2, MAX_FETCH)
    }

    const videoIds = Array.from(byVideo.keys())
    const placeholders = videoIds.map(() => '?').join(',')
    const rows = this.db.prepare<unknown[]>(`
      SELECT v.youtube_video_id, v.title, v.published_at, v.thumbnail_url, c.name as channel_name
      FROM videos v
      JOIN channels c ON c.id = v.channel_id
      WHERE v.youtube_video_id IN (${placeholders})
    `).all(...videoIds) as VideoRow[]

    const videoMap = new Map(rows.map(r => [r.youtube_video_id, r]))

    type Candidate = { videoId: string; entry: Entry; row: VideoRow; score: number }
    const candidates: Candidate[] = []
    const queryLower = params.query.toLowerCase()
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000

    for (const [videoId, entry] of byVideo) {
      const row = videoMap.get(videoId)
      if (!row) continue

      const publishedAt = row.published_at ?? ''
      if (params.fromDate && publishedAt < params.fromDate) continue
      if (params.toDate && publishedAt > params.toDate + 'T23:59:59') continue

      let score = entry.bestScore
      if (row.title.toLowerCase().includes(queryLower)) score += 0.15
      if (publishedAt) {
        const msSince = Date.now() - new Date(publishedAt).getTime()
        if (msSince >= 0 && msSince <= ninetyDaysMs) score += 0.05
      }

      candidates.push({ videoId, entry, row, score })
    }

    const topCandidates = candidates.sort((a, b) => b.score - a.score).slice(0, topK)
    if (topCandidates.length === 0) return []

    // Second pass: per-video queries so one video cannot crowd out another.
    // Use actual SQLite chunk counts as nResults to cover every chunk.
    const topVideoIds = topCandidates.map(c => c.videoId)
    const chunkCountPlaceholders = topVideoIds.map(() => '?').join(',')
    const chunkCountRows = this.db.prepare<unknown[]>(`
      SELECT v.youtube_video_id, COUNT(*) as chunk_count
      FROM transcript_chunks tc
      JOIN videos v ON v.id = tc.video_id
      WHERE v.youtube_video_id IN (${chunkCountPlaceholders})
      GROUP BY v.youtube_video_id
    `).all(...topVideoIds) as { youtube_video_id: string; chunk_count: number }[]
    const chunkCountByVideo = new Map(chunkCountRows.map(r => [r.youtube_video_id, r.chunk_count]))

    const perVideoResults = await Promise.all(
      topVideoIds.map(videoId =>
        this.chroma.query({
          queryText: params.query,
          nResults: chunkCountByVideo.get(videoId) ?? MAX_CHUNKS_PER_VIDEO_FALLBACK,
          videoIds: [videoId],
        } as ChromaSearchParams)
      )
    )

    const aboveThresholdByVideo = new Map<string, number>()
    for (let v = 0; v < topVideoIds.length; v++) {
      const videoId = topVideoIds[v]!
      const distances = perVideoResults[v]?.distances[0] ?? []
      const count = distances.filter(d => 1 - d >= RELEVANCE_THRESHOLD).length
      aboveThresholdByVideo.set(videoId, count)
    }

    return topCandidates.map(({ videoId, entry, row, score }) => {
      const publishedAt = row.published_at ?? ''
      const meta = metadatas[entry.bestChunkIdx]
      const snippet = documents[entry.bestChunkIdx] ?? ''
      const startSeconds = typeof meta?.startSeconds === 'number' ? meta.startSeconds as number : null
      const youtubeUrl = startSeconds !== null
        ? `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`
        : `https://www.youtube.com/watch?v=${videoId}`

      const aboveThresholdTotal = aboveThresholdByVideo.get(videoId) ?? 0
      const bestAboveThreshold = entry.bestScore >= RELEVANCE_THRESHOLD ? 1 : 0
      const additionalMatchCount = Math.max(0, aboveThresholdTotal - bestAboveThreshold)

      const result: SearchResult = {
        videoId,
        title: row.title,
        channelName: row.channel_name,
        publishedAt,
        thumbnailUrl: row.thumbnail_url,
        snippet,
        startSeconds,
        youtubeUrl,
        score,
      }

      if (additionalMatchCount > 0) result.additionalMatchCount = additionalMatchCount
      return result
    })
  }
}
