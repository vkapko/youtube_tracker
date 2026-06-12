import { ChromaClient, ChromaNotFoundError } from 'chromadb'
import type { TranscriptChunk } from './chunking'

export interface ChromaQueryResult {
  ids: string[][]
  documents: (string | null)[][]
  metadatas: (Record<string, string | number | boolean> | null)[][]
  distances: number[][]
}

interface ChromaCollectionLike {
  delete(args: {
    where: Record<string, string>
  }): Promise<unknown>
  upsert(args: {
    ids: string[]
    documents: string[]
    metadatas: Array<Record<string, string | number | boolean>>
  }): Promise<void>
  query(args: {
    queryTexts: string[]
    nResults: number
    where?: Record<string, unknown>
  }): Promise<ChromaQueryResult>
  get(args: {
    limit: number
    offset: number
    include: string[]
  }): Promise<{ ids: string[]; metadatas: (Record<string, string | number | boolean> | null)[] }>
}

export interface ChromaSearchParams {
  queryText: string
  nResults: number
  channelIds?: string[]
  videoIds?: string[]
  fromDate?: string
  toDate?: string
}

export interface ChromaClientLike {
  getOrCreateCollection(args: { name: string }): Promise<ChromaCollectionLike>
  deleteCollection(args: { name: string }): Promise<void>
}

export interface IndexChunksOptions {
  videoId: string
  channelId: string
  title: string
  channelTitle: string
  publishedAt: string
  transcriptFilePath: string
  chunks: TranscriptChunk[]
}

function createClient(): ChromaClientLike {
  const url = new URL(process.env.CHROMA_URL ?? 'http://localhost:8000')
  return new ChromaClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    ssl: url.protocol === 'https:',
  }) as unknown as ChromaClientLike
}

export class ChromaService {
  private readonly collectionName = process.env.CHROMA_COLLECTION ?? 'youtube_transcript_chunks'

  constructor(private readonly client: ChromaClientLike = createClient()) {}

  async indexChunks(options: IndexChunksOptions): Promise<void> {
    const collection = await this.client.getOrCreateCollection({ name: this.collectionName })
    await collection.delete({ where: { videoId: options.videoId } })

    if (options.chunks.length === 0) return

    await collection.upsert({
      ids: options.chunks.map(chunk => `${options.videoId}:${chunk.chunkIndex}`),
      documents: options.chunks.map(chunk => chunk.text),
      metadatas: options.chunks.map(chunk => {
        const metadata: Record<string, string | number | boolean> = {
          videoId: options.videoId,
          channelId: options.channelId,
          title: options.title,
          channelTitle: options.channelTitle,
          publishedAt: Math.floor(new Date(options.publishedAt).getTime() / 1000),
          transcriptFilePath: options.transcriptFilePath,
        }
        if (chunk.startSeconds !== undefined) metadata.startSeconds = chunk.startSeconds
        if (chunk.endSeconds !== undefined) metadata.endSeconds = chunk.endSeconds
        return metadata
      }),
    })
  }

  async query(params: ChromaSearchParams): Promise<ChromaQueryResult> {
    const collection = await this.client.getOrCreateCollection({ name: this.collectionName })

    const conditions: Record<string, unknown>[] = []
    if (params.channelIds?.length) conditions.push({ channelId: { $in: params.channelIds } })
    if (params.videoIds?.length) conditions.push({ videoId: { $in: params.videoIds } })
    if (params.fromDate) conditions.push({ publishedAt: { $gte: Math.floor(new Date(params.fromDate).getTime() / 1000) } })
    if (params.toDate) {
      const end = new Date(params.toDate)
      end.setUTCHours(23, 59, 59, 999)
      conditions.push({ publishedAt: { $lte: Math.floor(end.getTime() / 1000) } })
    }

    const where = conditions.length === 0 ? undefined
      : conditions.length === 1 ? conditions[0]
      : { $and: conditions }

    return collection.query({
      queryTexts: [params.queryText],
      nResults: params.nResults,
      where,
    })
  }

  async hasStringPublishedAt(): Promise<boolean> {
    const collection = await this.client.getOrCreateCollection({ name: this.collectionName })
    const pageSize = 1000
    let offset = 0
    while (true) {
      const page = await collection.get({ limit: pageSize, offset, include: ['metadatas'] })
      if (page.metadatas.some(m => m && typeof m.publishedAt === 'string')) return true
      if (page.ids.length < pageSize) break
      offset += pageSize
    }
    return false
  }

  async resetCollection(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.collectionName })
    } catch (error) {
      if (!(error instanceof ChromaNotFoundError)) throw error
    }
    await this.client.getOrCreateCollection({ name: this.collectionName })
  }
}
