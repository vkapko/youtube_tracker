import { ChromaClient, ChromaNotFoundError } from 'chromadb'
import type { TranscriptChunk } from './chunking'

interface ChromaCollectionLike {
  delete(args: {
    where: Record<string, string>
  }): Promise<unknown>
  upsert(args: {
    ids: string[]
    documents: string[]
    metadatas: Array<Record<string, string | number | boolean>>
  }): Promise<void>
}

interface ChromaClientLike {
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

function createClient(): ChromaClient {
  const url = new URL(process.env.CHROMA_URL ?? 'http://localhost:8000')
  return new ChromaClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    ssl: url.protocol === 'https:',
  })
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
          publishedAt: options.publishedAt,
          transcriptFilePath: options.transcriptFilePath,
        }
        if (chunk.startSeconds !== undefined) metadata.startSeconds = chunk.startSeconds
        if (chunk.endSeconds !== undefined) metadata.endSeconds = chunk.endSeconds
        return metadata
      }),
    })
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
