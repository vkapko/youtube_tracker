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

const RECORD_DETAILED_SUMMARY_TOOL: Anthropic.Tool = {
  name: 'record_detailed_summary',
  description: 'Record a detailed summary of the video.',
  input_schema: {
    type: 'object' as const,
    properties: {
      detailedSummary: {
        type: 'string',
        description: 'A detailed, multi-paragraph summary covering all major points discussed.',
      },
    },
    required: ['detailedSummary'],
  },
}

const RECORD_ACTION_ITEMS_TOOL: Anthropic.Tool = {
  name: 'record_action_items',
  description: 'Record actionable items from the video.',
  input_schema: {
    type: 'object' as const,
    properties: {
      actionItems: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete, actionable steps or recommendations mentioned in the video.',
      },
    },
    required: ['actionItems'],
  },
}

const RECORD_TECHNICAL_TERMS_TOOL: Anthropic.Tool = {
  name: 'record_technical_terms',
  description: 'Record technical terms from the video.',
  input_schema: {
    type: 'object' as const,
    properties: {
      technicalTerms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technical terms, jargon, or concepts introduced or explained in the video.',
      },
    },
    required: ['technicalTerms'],
  },
}

const RECORD_NOTABLE_QUOTES_TOOL: Anthropic.Tool = {
  name: 'record_notable_quotes',
  description: 'Record notable quotes from the video.',
  input_schema: {
    type: 'object' as const,
    properties: {
      notableQuotes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Memorable or important quotes from the video.',
      },
    },
    required: ['notableQuotes'],
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

  // Forced tool_choice is incompatible with extended thinking; use auto when thinking is on.
  private async callWithTool<T>(
    tool: Anthropic.Tool,
    toolName: string,
    prompt: string,
    extract: (input: unknown) => T
  ): Promise<T> {
    const useThinking = supportsThinking(this.model)
    const thinking = useThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET_TOKENS } }
      : {}
    const toolChoice = useThinking
      ? { type: 'auto' as const }
      : { type: 'tool' as const, name: toolName }
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8000,
      ...thinking,
      tools: [tool],
      tool_choice: toolChoice,
      messages: [{ role: 'user', content: prompt }],
    })
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName
    )
    if (!toolUse) throw new Error(`Claude did not call the ${toolName} tool`)
    return extract(toolUse.input)
  }

  async summarizeVideo(meta: VideoMeta, transcriptText: string): Promise<SummarizeResult> {
    const tokenCount = this.countTokensFn(transcriptText)
    if (tokenCount <= this.maxTokensPerSection) {
      return this.summarizeSingle(meta, transcriptText)
    }
    return this.summarizeMapReduce(meta, transcriptText)
  }

  private async summarizeSingle(meta: VideoMeta, transcript: string): Promise<SummarizeResult> {
    return this.callWithTool(
      RECORD_SUMMARY_TOOL,
      'record_summary',
      `Summarize this YouTube video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nTranscript:\n${transcript}`,
      (input) => {
        const i = input as { shortSummary: string; keyTopics: string[] }
        return { shortSummary: i.shortSummary, keyTopics: i.keyTopics }
      }
    )
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

    return this.callWithTool(
      RECORD_SUMMARY_TOOL,
      'record_summary',
      `Combine these section summaries into a single coherent summary for the full video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nSection summaries:\n${combinedText}`,
      (input) => {
        const i = input as { shortSummary: string; keyTopics: string[] }
        return { shortSummary: i.shortSummary, keyTopics: i.keyTopics }
      }
    )
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

  async generateDetailedSummary(meta: VideoMeta, transcriptText: string): Promise<string> {
    const tokenCount = this.countTokensFn(transcriptText)
    if (tokenCount <= this.maxTokensPerSection) {
      return this.detailedSummarySingle(meta, transcriptText)
    }
    const sections = this.splitIntoSections(transcriptText)
    const partials: string[] = []
    for (let i = 0; i < sections.length; i++) {
      partials.push(
        await this.detailedSummarySingle(
          { title: `${meta.title} (part ${i + 1}/${sections.length})`, channelTitle: meta.channelTitle },
          sections[i]
        )
      )
    }
    return this.reduceDetailedSummary(meta, partials)
  }

  private async reduceDetailedSummary(meta: VideoMeta, partials: string[]): Promise<string> {
    if (partials.length === 1) return partials[0]

    const combinedText = partials.map((s, i) => `Part ${i + 1}: ${s}`).join('\n\n')

    if (this.countTokensFn(combinedText) > this.maxTokensPerSection) {
      if (partials.length > 2) {
        const mid = Math.ceil(partials.length / 2)
        const [left, right] = await Promise.all([
          this.reduceDetailedSummary(meta, partials.slice(0, mid)),
          this.reduceDetailedSummary(meta, partials.slice(mid)),
        ])
        return this.reduceDetailedSummary(meta, [left, right])
      }
      // length === 2 and still over budget: individual summaries are too large to split further; fall through best-effort
    }

    return this.detailedSummarySingle(meta, `[Combine into one detailed summary]\n\nSection summaries:\n${combinedText}`)
  }

  private detailedSummarySingle(meta: VideoMeta, transcript: string): Promise<string> {
    return this.callWithTool(
      RECORD_DETAILED_SUMMARY_TOOL,
      'record_detailed_summary',
      `Generate a detailed summary of this YouTube video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nTranscript:\n${transcript}`,
      (input) => (input as { detailedSummary: string }).detailedSummary
    )
  }

  async generateActionItems(meta: VideoMeta, transcriptText: string): Promise<string[]> {
    return this.generateArrayLazy(
      meta, transcriptText,
      RECORD_ACTION_ITEMS_TOOL,
      'Extract action items from this YouTube video',
      'Combine these action items from each section into a final deduplicated list',
      'record_action_items', 'actionItems'
    )
  }

  async generateTechnicalTerms(meta: VideoMeta, transcriptText: string): Promise<string[]> {
    return this.generateArrayLazy(
      meta, transcriptText,
      RECORD_TECHNICAL_TERMS_TOOL,
      'Extract technical terms from this YouTube video',
      'Combine these technical terms from each section into a final deduplicated list',
      'record_technical_terms', 'technicalTerms'
    )
  }

  async generateNotableQuotes(meta: VideoMeta, transcriptText: string): Promise<string[]> {
    return this.generateArrayLazy(
      meta, transcriptText,
      RECORD_NOTABLE_QUOTES_TOOL,
      'Extract notable quotes from this YouTube video',
      'Combine these notable quotes from each section into a final deduplicated list',
      'record_notable_quotes', 'notableQuotes'
    )
  }

  private async generateArrayLazy(
    meta: VideoMeta,
    transcriptText: string,
    tool: Anthropic.Tool,
    taskDescription: string,
    reduceDescription: string,
    toolName: string,
    resultKey: string
  ): Promise<string[]> {
    const extract = (input: unknown) => (input as Record<string, string[]>)[resultKey]

    const tokenCount = this.countTokensFn(transcriptText)
    if (tokenCount <= this.maxTokensPerSection) {
      return this.callWithTool(
        tool, toolName,
        `${taskDescription}.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nTranscript:\n${transcriptText}`,
        extract
      )
    }

    const sections = this.splitIntoSections(transcriptText)
    const partials: string[][] = []
    for (let i = 0; i < sections.length; i++) {
      const partMeta = { title: `${meta.title} (part ${i + 1}/${sections.length})`, channelTitle: meta.channelTitle }
      partials.push(
        await this.callWithTool(
          tool, toolName,
          `${taskDescription}.\n\nTitle: ${partMeta.title}\nChannel: ${partMeta.channelTitle}\n\nTranscript:\n${sections[i]}`,
          extract
        )
      )
    }

    return this.reduceArray(meta, partials, tool, toolName, reduceDescription, extract)
  }

  private async reduceArray(
    meta: VideoMeta,
    partials: string[][],
    tool: Anthropic.Tool,
    toolName: string,
    reduceDescription: string,
    extract: (input: unknown) => string[]
  ): Promise<string[]> {
    if (partials.length === 1) return partials[0]

    const combinedText = partials.map((items, i) => `Part ${i + 1}:\n${items.map(item => `- ${item}`).join('\n')}`).join('\n\n')

    if (this.countTokensFn(combinedText) > this.maxTokensPerSection) {
      if (partials.length > 2) {
        const mid = Math.ceil(partials.length / 2)
        const [left, right] = await Promise.all([
          this.reduceArray(meta, partials.slice(0, mid), tool, toolName, reduceDescription, extract),
          this.reduceArray(meta, partials.slice(mid), tool, toolName, reduceDescription, extract),
        ])
        return this.reduceArray(meta, [left, right], tool, toolName, reduceDescription, extract)
      }
      // length === 2 and still over budget: fall through best-effort
    }

    return this.callWithTool(
      tool, toolName,
      `${reduceDescription} for the full video.\n\nTitle: ${meta.title}\nChannel: ${meta.channelTitle}\n\nSection items:\n${combinedText}`,
      extract
    )
  }
}
