import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { ClaudeService } from '../src/services/claude.service'

function makeClient(createFn: ReturnType<typeof vi.fn>) {
  return { messages: { create: createFn } } as unknown as Anthropic
}

function toolUseResponse(input: { shortSummary: string; keyTopics: string[] }) {
  return {
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        name: 'record_summary',
        input,
      },
    ],
  }
}

describe('ClaudeService.summarizeVideo', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreate = vi.fn()
  })

  it('returns shortSummary and keyTopics parsed from Claude tool-use response', async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse({
        shortSummary: 'This video explains gradient descent.',
        keyTopics: ['gradient descent', 'optimization', 'neural networks'],
      })
    )

    const service = new ClaudeService(makeClient(mockCreate))
    const result = await service.summarizeVideo(
      { title: 'ML Fundamentals', channelTitle: 'AI School' },
      'Today we cover gradient descent and how it works.'
    )

    expect(result.shortSummary).toBe('This video explains gradient descent.')
    expect(result.keyTopics).toEqual(['gradient descent', 'optimization', 'neural networks'])
  })

  it('calls Claude with default model claude-sonnet-4-6', async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse({ shortSummary: 'A summary.', keyTopics: ['topic'] })
    )

    const service = new ClaudeService(makeClient(mockCreate))
    await service.summarizeVideo({ title: 'T', channelTitle: 'C' }, 'text')

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))
  })

  it('uses CLAUDE_SUMMARY_MODEL env var when set', async () => {
    const originalEnv = process.env.CLAUDE_SUMMARY_MODEL
    process.env.CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5'

    mockCreate.mockResolvedValueOnce(
      toolUseResponse({ shortSummary: 'A summary.', keyTopics: ['topic'] })
    )

    const service = new ClaudeService(makeClient(mockCreate))
    await service.summarizeVideo({ title: 'T', channelTitle: 'C' }, 'text')

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))

    process.env.CLAUDE_SUMMARY_MODEL = originalEnv
  })

  it('applies map-reduce when transcript exceeds maxTokensPerSection', async () => {
    // Two sections: Claude called 3 times (section 1, section 2, combine)
    mockCreate
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Part 1 summary.', keyTopics: ['topic-a'] })
      )
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Part 2 summary.', keyTopics: ['topic-b'] })
      )
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Combined summary.', keyTopics: ['topic-a', 'topic-b'] })
      )

    // Inject a word-count tokenizer so binary-search splitting is deterministic.
    // Transcript has 10 words; maxTokensPerSection=5 → exactly 2 sections.
    const service = new ClaudeService(makeClient(mockCreate), {
      maxTokensPerSection: 5,
      countTokensFn: (text: string) => text.split(' ').filter(w => w.length > 0).length,
    })
    const result = await service.summarizeVideo(
      { title: 'Long Video', channelTitle: 'Channel' },
      'first half of the transcript second half of the transcript'
    )

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.shortSummary).toBe('Combined summary.')
    expect(result.keyTopics).toEqual(['topic-a', 'topic-b'])
  })

  it('applies map-reduce for CJK text without spaces', async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Part 1.', keyTopics: ['topic-a'] })
      )
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Part 2.', keyTopics: ['topic-b'] })
      )
      .mockResolvedValueOnce(
        toolUseResponse({ shortSummary: 'Combined.', keyTopics: ['topic-a', 'topic-b'] })
      )

    // Tokenizer counts Unicode characters; maxTokensPerSection=5 splits 10-char CJK string into 2.
    const service = new ClaudeService(makeClient(mockCreate), {
      maxTokensPerSection: 5,
      countTokensFn: (text: string) => [...text].length,
    })
    const result = await service.summarizeVideo(
      { title: 'CJK Video', channelTitle: 'Channel' },
      '一二三四五六七八九十'
    )

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.shortSummary).toBe('Combined.')
  })

  it('reduces hierarchically when combined section summaries exceed the context limit', async () => {
    // 4-section transcript (40 words, threshold=10) → 4 map calls.
    // Combined text of 4 section summaries ≈13 words > 10 AND length>2 → split into 2×2.
    // Each 2-summary group ≈7 words ≤10 → 2 reduce calls.
    // Final 2 intermediate results ≈7 words ≤10 → 1 reduce call. Total: 7 calls.
    mockCreate
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 's.', keyTopics: ['t'] })) // map 1
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 's.', keyTopics: ['t'] })) // map 2
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 's.', keyTopics: ['t'] })) // map 3
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 's.', keyTopics: ['t'] })) // map 4
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'g1.', keyTopics: ['ta'] })) // reduce [1,2]
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'g2.', keyTopics: ['tb'] })) // reduce [3,4]
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'final.', keyTopics: ['ta', 'tb'] })) // reduce final

    const wordCount = (text: string) => text.split(' ').filter(w => w.length > 0).length
    const service = new ClaudeService(makeClient(mockCreate), {
      maxTokensPerSection: 10,
      countTokensFn: wordCount,
    })
    const transcript = Array.from({ length: 40 }, (_, i) => `w${i + 1}`).join(' ')
    const result = await service.summarizeVideo({ title: 'Long Video', channelTitle: 'Channel' }, transcript)

    expect(mockCreate).toHaveBeenCalledTimes(7)
    expect(result.shortSummary).toBe('final.')
    expect(result.keyTopics).toEqual(['ta', 'tb'])
  })

  it('falls through to API when final 2-item merge still overflows the token budget', async () => {
    // countTokensFn always returns a value above maxTokensPerSection so the
    // 2-item combined text is "too large", but we cannot split further.
    // The service must still make the API call (best-effort) rather than loop.
    mockCreate
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'p1.', keyTopics: ['a'] })) // map 1
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'p2.', keyTopics: ['b'] })) // map 2
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'final.', keyTopics: ['a', 'b'] })) // reduce

    // threshold=5; each section = 1 word; both summaries combined always > 5 words
    const service = new ClaudeService(makeClient(mockCreate), {
      maxTokensPerSection: 5,
      countTokensFn: (text: string) => {
        // Sections are short (1 word each) so they split into exactly 2.
        // Combined summary text is longer than 5, simulating an overflow at reduction.
        const words = text.split(' ').filter(w => w.length > 0).length
        return words > 1 ? 6 : words
      },
    })
    const result = await service.summarizeVideo(
      { title: 'T', channelTitle: 'C' },
      'first second'
    )

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.shortSummary).toBe('final.')
  })

  it('hard-splits an oversized single word segment that exceeds the token budget', async () => {
    // Intl.Segmenter returns one word segment for a long unbroken Latin/code string.
    // The char-level fallback must split it so each section fits within the budget.
    mockCreate
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'Part 1.', keyTopics: ['a'] }))
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'Part 2.', keyTopics: ['b'] }))
      .mockResolvedValueOnce(toolUseResponse({ shortSummary: 'Combined.', keyTopics: ['a', 'b'] }))

    const service = new ClaudeService(makeClient(mockCreate), {
      maxTokensPerSection: 100,
      countTokensFn: (text: string) => [...text].length,
    })
    // 200-char unbroken string — one word segment, exceeds budget of 100 chars.
    const transcript = 'A'.repeat(200)
    const result = await service.summarizeVideo({ title: 'T', channelTitle: 'C' }, transcript)

    // 2 map calls (100-char sections) + 1 reduce call
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.shortSummary).toBe('Combined.')
  })

  it('throws when Claude does not call the record_summary tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Here is a summary...' }],
    })

    const service = new ClaudeService(makeClient(mockCreate))
    await expect(
      service.summarizeVideo({ title: 'T', channelTitle: 'C' }, 'text')
    ).rejects.toThrow('record_summary')
  })

  it('omits thinking param for older models that do not support it', async () => {
    const originalEnv = process.env.CLAUDE_SUMMARY_MODEL
    process.env.CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5'

    mockCreate.mockResolvedValueOnce(
      toolUseResponse({ shortSummary: 'A summary.', keyTopics: ['topic'] })
    )

    const service = new ClaudeService(makeClient(mockCreate))
    await service.summarizeVideo({ title: 'T', channelTitle: 'C' }, 'text')

    const call = mockCreate.mock.calls[0][0]
    expect(call.thinking).toBeUndefined()

    process.env.CLAUDE_SUMMARY_MODEL = originalEnv
  })

  it('includes thinking param for thinking-capable models', async () => {
    const originalEnv = process.env.CLAUDE_SUMMARY_MODEL
    process.env.CLAUDE_SUMMARY_MODEL = 'claude-sonnet-4-6'

    mockCreate.mockResolvedValueOnce(
      toolUseResponse({ shortSummary: 'A summary.', keyTopics: ['topic'] })
    )

    const service = new ClaudeService(makeClient(mockCreate))
    await service.summarizeVideo({ title: 'T', channelTitle: 'C' }, 'text')

    const call = mockCreate.mock.calls[0][0]
    expect(call.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 })

    process.env.CLAUDE_SUMMARY_MODEL = originalEnv
  })
})
