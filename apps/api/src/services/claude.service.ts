import Anthropic from '@anthropic-ai/sdk'
import { countTokens } from 'gpt-tokenizer'

export interface SummarizeResult {
  shortSummary: string
  keyTopics: string[]
}

interface VideoMeta {
  title: string
  channelTitle: string
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-fable-5': 1_000_000,
  'claude-mythos-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
}

// Models that support extended thinking; older 4.5-generation models do not.
const THINKING_CAPABLE_MODELS = new Set([
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
])

// Conservative fallback for models not in the table above
const DEFAULT_CONTEXT_WINDOW = 100_000
// Must match max_tokens used in API calls below
const MAX_OUTPUT_TOKENS = 8_000
// Budget for prompt instructions + title + channel name
const PROMPT_OVERHEAD_TOKENS = 500
// Thinking token budget — only used for thinking-capable models
const THINKING_BUDGET_TOKENS = 5_000

function contextWindowForModel(model: string): number {
  if (model in MODEL_CONTEXT_WINDOWS) return MODEL_CONTEXT_WINDOWS[model]
  // Handle date-suffixed variants (e.g. "claude-opus-4-8-20251201")
  for (const [prefix, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(prefix)) return window
  }
  return DEFAULT_CONTEXT_WINDOW
}

function supportsThinking(model: string): boolean {
  if (THINKING_CAPABLE_MODELS.has(model)) return true
  for (const prefix of THINKING_CAPABLE_MODELS) {
    if (model.startsWith(prefix)) return true
  }
  return false
}

const RECORD_SUMMARY_TOOL: Anthropic.Tool = {
  name: 'record_summary',
  description: 'Record the summary and key topics for the video.',
  input_schema: {
    type: 'object' as const,
    properties: {
      shortSummary: {
        type: 'string',
        description: 'A 2-3 sentence summary of the video content.',
      },
      keyTopics: {
        type: 'array',
        items: { type: 'string' },
        description: '3-7 key topics covered in the video.',
      },
    },
    required: ['shortSummary', 'keyTopics'],
  },
}

export class ClaudeService {
  private readonly model: string
  private readonly maxTokensPerSection: number
  private readonly countTokensFn: (text: string) => number

  constructor(
    private readonly anthropic: Anthropic = new Anthropic(),
    options: {
      maxTokensPerSection?: number
      countTokensFn?: (text: string) => number
    } = {}
  ) {
    this.model = process.env.CLAUDE_SUMMARY_MODEL ?? 'claude-sonnet-4-6'
    const contextWindow = contextWindowForModel(this.model)
    this.maxTokensPerSection =
      options.maxTokensPerSection ?? contextWindow - MAX_OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS
    this.countTokensFn = options.countTokensFn ?? countTokens
  }

  async summarizeVideo(meta: VideoMeta, transcriptText: string): Promise<SummarizeResult> {
    const tokenCount = this.countTokensFn(transcriptText)
    if (tokenCount <= this.maxTokensPerSection) {
      return this.summarizeSingle(meta, transcriptText)
    }
    return this.summarizeMapReduce(meta, transcriptText)
  }

  private async summarizeSingle(meta: VideoMeta, transcript: string): Promise<SummarizeResult> {
    const useThinking = supportsThinking(this.model)
    const thinking = useThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET_TOKENS } }
      : {}
    // Forced tool_choice is incompatible with extended thinking; use auto when thinking is on.
    const toolChoice = useThinking
      ? { type: 'auto' as const }
      : { type: 'tool' as const, name: 'record_summary' }
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8000,
      ...thinking,
      tools: [RECORD_SUMMARY_TOOL],
      tool_choice: toolChoice,
      messages: [
        {
          role: 'user',
          content: `Summarize this YouTube video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nTranscript:\n${transcript}`,
        },
      ],
    })
    return this.extractFromResponse(response)
  }

  private async summarizeMapReduce(
    meta: VideoMeta,
    transcriptText: string
  ): Promise<SummarizeResult> {
    const sections = this.splitIntoSections(transcriptText)

    const sectionSummaries: SummarizeResult[] = []
    for (let i = 0; i < sections.length; i++) {
      sectionSummaries.push(
        await this.summarizeSingle(
          { title: `${meta.title} (part ${i + 1}/${sections.length})`, channelTitle: meta.channelTitle },
          sections[i]
        )
      )
    }

    return this.reduceResults(meta, sectionSummaries)
  }

  private async reduceResults(meta: VideoMeta, results: SummarizeResult[]): Promise<SummarizeResult> {
    if (results.length === 1) return results[0]

    const combinedText = results
      .map((s, i) => `Part ${i + 1}: ${s.shortSummary}\nTopics: ${s.keyTopics.join(', ')}`)
      .join('\n\n')

    if (this.countTokensFn(combinedText) > this.maxTokensPerSection) {
      if (results.length > 2) {
        const mid = Math.ceil(results.length / 2)
        const [left, right] = await Promise.all([
          this.reduceResults(meta, results.slice(0, mid)),
          this.reduceResults(meta, results.slice(mid)),
        ])
        return this.reduceResults(meta, [left, right])
      }
      // length === 2 and still over budget: individual summaries are too large
      // to split further. Fall through and let the API handle it best-effort.
    }

    const useThinking = supportsThinking(this.model)
    const thinking = useThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET_TOKENS } }
      : {}
    const toolChoice = useThinking
      ? { type: 'auto' as const }
      : { type: 'tool' as const, name: 'record_summary' }
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8000,
      ...thinking,
      tools: [RECORD_SUMMARY_TOOL],
      tool_choice: toolChoice,
      messages: [
        {
          role: 'user',
          content: `Combine these section summaries into a single coherent summary for the full video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nSection summaries:\n${combinedText}`,
        },
      ],
    })
    return this.extractFromResponse(response)
  }

  private splitIntoSections(text: string): string[] {
    // Use Intl.Segmenter word segments so CJK and other space-free scripts
    // produce many small units rather than one oversized chunk.
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    const segments = Array.from(segmenter.segment(text), s => s.segment)

    if (segments.length === 0) return []

    // Binary-search for the largest segment slice that fits maxTokensPerSection.
    const sections: string[] = []
    let start = 0

    while (start < segments.length) {
      let lo = start + 1
      let hi = segments.length
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (this.countTokensFn(segments.slice(start, mid).join('')) <= this.maxTokensPerSection) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }
      const section = segments.slice(start, lo).join('')
      // A single segment can exceed the budget (e.g. a long URL or code string).
      // Fall back to character-level binary search to guarantee the budget is met.
      if (lo === start + 1 && this.countTokensFn(section) > this.maxTokensPerSection) {
        let cStart = 0
        while (cStart < section.length) {
          let cLo = cStart + 1
          let cHi = section.length
          while (cLo < cHi) {
            const cMid = (cLo + cHi + 1) >> 1
            if (this.countTokensFn(section.slice(cStart, cMid)) <= this.maxTokensPerSection) {
              cLo = cMid
            } else {
              cHi = cMid - 1
            }
          }
          sections.push(section.slice(cStart, cLo))
          cStart = cLo
        }
      } else {
        sections.push(section)
      }
      start = lo
    }

    return sections
  }

  private extractFromResponse(response: Anthropic.Message): SummarizeResult {
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'record_summary'
    )
    if (!toolUse) {
      throw new Error('Claude did not call the record_summary tool')
    }
    const input = toolUse.input as { shortSummary: string; keyTopics: string[] }
    return { shortSummary: input.shortSummary, keyTopics: input.keyTopics }
  }
}
