import Anthropic from '@anthropic-ai/sdk'
import { ChromaService } from './chroma'
import type { ChromaSearchParams } from './chroma'

export interface ChatParams {
  question: string
  channelIds?: string[]
  topK?: number
}

export interface ChatSource {
  videoId: string
  title: string
  timestamp: number | null
  reason: string
}

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; sources: ChatSource[] }
  | { type: 'error'; message: string }

type ChromaLike = Pick<ChromaService, 'query'>

const DEFAULT_TOP_K = 5
const MAX_REASON_LENGTH = 150

const BASE_SYSTEM_PROMPT = `You are a helpful assistant answering questions from YouTube video transcripts.
Answer ONLY from the provided transcript excerpts below. Do not hallucinate or add information not present in the excerpts.
If the excerpts do not contain enough information to answer the question, respond with exactly: "I don't have enough information in the indexed videos to answer this question."`

const CITATION_INSTRUCTION = `When drawing on an excerpt, cite it inline with [N] notation matching its excerpt number (e.g. [1], [2]). Each excerpt header shows the video title and timestamp — include both in your citation so the reader knows the exact source (e.g. "...as discussed in \\"Video Title\\" at 1:23 [1]"). Only cite excerpts you actually use.`

const NO_CHUNKS_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

No relevant transcript excerpts were found. There is not enough information in the indexed videos to answer this question. You MUST respond with: "I don't have enough information in the indexed videos to answer this question."`

export class ChatService {
  private readonly model: string

  constructor(
    private readonly chroma: ChromaLike = new ChromaService(),
    private readonly anthropic: Anthropic = new Anthropic()
  ) {
    this.model = process.env.CLAUDE_CHAT_MODEL ?? 'claude-sonnet-4-6'
  }

  async *stream(params: ChatParams): AsyncGenerator<ChatEvent> {
    const topK = params.topK ?? DEFAULT_TOP_K

    const chromaResult = await this.chroma.query({
      queryText: params.question,
      nResults: topK,
      channelIds: params.channelIds,
    } as ChromaSearchParams)

    const ids = chromaResult.ids[0] ?? []
    const documents = chromaResult.documents[0] ?? []
    const metadatas = chromaResult.metadatas[0] ?? []

    const excerpts = ids
      .map((_, i) => {
        const meta = metadatas[i]
        const text = documents[i] ?? ''
        if (!text) return null
        const videoId = (meta?.videoId as string) ?? ''
        const title = (meta?.title as string) ?? 'Unknown Video'
        const startSeconds =
          typeof meta?.startSeconds === 'number' ? (meta.startSeconds as number) : null
        return { videoId, title, text, startSeconds }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    const systemPrompt =
      excerpts.length === 0
        ? NO_CHUNKS_SYSTEM_PROMPT
        : buildSystemPrompt(excerpts)

    const anthropicStream = this.anthropic.messages.stream({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: params.question }],
    })

    let fullText = ''
    for await (const event of anthropicStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullText += event.delta.text
        yield { type: 'token', text: event.delta.text }
      }
    }

    const citedIndices = parseCitedIndices(fullText, excerpts.length)
    const sources: ChatSource[] = citedIndices.map(i => ({
      videoId: excerpts[i].videoId,
      title: excerpts[i].title,
      timestamp: excerpts[i].startSeconds,
      reason: excerpts[i].text.slice(0, MAX_REASON_LENGTH),
    }))

    yield { type: 'done', sources }
  }
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function buildSystemPrompt(
  excerpts: { title: string; text: string; startSeconds: number | null }[]
): string {
  const excerptText = excerpts
    .map((e, i) => {
      const ts = e.startSeconds !== null ? ` at ${formatTimestamp(e.startSeconds)}` : ''
      return `[Excerpt ${i + 1}]\nVideo: "${e.title}"${ts}\n---\n${e.text}`
    })
    .join('\n\n')

  return `${BASE_SYSTEM_PROMPT}\n${CITATION_INSTRUCTION}\n\n${excerptText}`
}

function parseCitedIndices(text: string, excerptCount: number): number[] {
  const seen = new Set<number>()
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = parseInt(match[1], 10)
    if (n >= 1 && n <= excerptCount) seen.add(n - 1)
  }
  return [...seen].sort((a, b) => a - b)
}
