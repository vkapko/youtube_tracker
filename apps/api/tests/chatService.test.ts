import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { ChatService, type ChatEvent } from '../src/services/chat.service'
import type { ChromaService } from '../src/services/chroma'

type ChromaLike = Pick<ChromaService, 'query'>

const emptyChromaResult = {
  ids: [[]],
  documents: [[]],
  metadatas: [[]],
  distances: [[]],
}

function makeChroma(queryFn = vi.fn()): ChromaLike {
  return { query: queryFn }
}

function makeAnthropic(streamFn = vi.fn()): Anthropic {
  return { messages: { stream: streamFn } } as unknown as Anthropic
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function makeStreamGen(...texts: string[]) {
  return (async function* () {
    for (const text of texts) {
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
    }
    yield { type: 'message_stop' }
  })()
}

describe('ChatService.stream', () => {
  let mockQuery: ReturnType<typeof vi.fn>
  let mockStream: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockQuery = vi.fn()
    mockStream = vi.fn()
  })

  it('queries Chroma with the question and channelIds', async () => {
    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'What is ML?', channelIds: ['UCabc'] }))

    expect(mockQuery).toHaveBeenCalledWith({
      queryText: 'What is ML?',
      nResults: 5,
      channelIds: ['UCabc'],
    })
  })

  it('uses topK param as nResults', async () => {
    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'test?', topK: 8 }))

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ nResults: 8 }))
  })

  it('calls Anthropic with system prompt containing excerpt text', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [['This is the key transcript excerpt']],
      metadatas: [[{ videoId: 'vid1', title: 'ML Video', channelTitle: 'ML Chan', startSeconds: 60 }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'What is ML?' }))

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('This is the key transcript excerpt'),
      })
    )
  })

  it('includes video title and timestamp in the system prompt', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [['some text']],
      metadatas: [[{ videoId: 'vid1', title: 'Deep Learning Basics', channelTitle: 'Ch', startSeconds: 90 }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'test?' }))

    const systemPrompt = mockStream.mock.calls[0][0].system as string
    expect(systemPrompt).toContain('Deep Learning Basics')
    expect(systemPrompt).toContain('1:30')
  })

  it('yields token events for each text delta', async () => {
    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen('Hello ', 'world'))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const tokens = events.filter(e => e.type === 'token') as Extract<ChatEvent, { type: 'token' }>[]
    expect(tokens).toHaveLength(2)
    expect(tokens[0].text).toBe('Hello ')
    expect(tokens[1].text).toBe('world')
  })

  it('yields done event with videoId, title, and timestamp for cited excerpts', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [['excerpt about neural networks']],
      metadatas: [[{ videoId: 'vid1', title: 'ML Video', channelTitle: 'Ch', startSeconds: 90 }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen('Neural nets are great [1].'))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const doneEvent = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(doneEvent).toBeDefined()
    expect(doneEvent.sources).toHaveLength(1)
    expect(doneEvent.sources[0]).toMatchObject({
      videoId: 'vid1',
      title: 'ML Video',
      timestamp: 90,
    })
  })

  it('yields empty sources in done event when response cites no excerpts', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [['excerpt about neural networks']],
      metadatas: [[{ videoId: 'vid1', title: 'ML Video', channelTitle: 'Ch', startSeconds: 90 }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen("I don't have enough information."))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const doneEvent = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(doneEvent.sources).toHaveLength(0)
  })

  it('only returns sources for cited excerpts when multiple are retrieved', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0', 'vid2:0', 'vid3:0']],
      documents: [['excerpt one', 'excerpt two', 'excerpt three']],
      metadatas: [[
        { videoId: 'vid1', title: 'V1', channelTitle: 'C', startSeconds: 0 },
        { videoId: 'vid2', title: 'V2', channelTitle: 'C', startSeconds: 0 },
        { videoId: 'vid3', title: 'V3', channelTitle: 'C', startSeconds: 0 },
      ]],
      distances: [[0.1, 0.2, 0.3]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen('According to [1] and [3], the answer is yes.'))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const doneEvent = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(doneEvent.sources).toHaveLength(2)
    expect(doneEvent.sources.map(s => s.videoId)).toEqual(['vid1', 'vid3'])
  })

  it('includes a reason (excerpt snippet) in each source', async () => {
    const longExcerpt = 'A'.repeat(200)
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [[longExcerpt]],
      metadatas: [[{ videoId: 'vid1', title: 'V', channelTitle: 'C', startSeconds: 0 }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen('Answer [1].'))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const doneEvent = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(doneEvent.sources[0].reason.length).toBeLessThanOrEqual(150)
  })

  it('yields done as the final event with a sources array', async () => {
    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    expect(events[events.length - 1]).toEqual({ type: 'done', sources: [] })
  })

  it('includes "not enough information" instruction in system prompt when no chunks found', async () => {
    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'obscure question?' }))

    const systemPrompt = mockStream.mock.calls[0][0].system as string
    expect(systemPrompt.toLowerCase()).toContain('not enough information')
  })

  it('uses CLAUDE_CHAT_MODEL env var', async () => {
    const orig = process.env.CLAUDE_CHAT_MODEL
    process.env.CLAUDE_CHAT_MODEL = 'claude-haiku-4-5'

    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'test?' }))

    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))

    process.env.CLAUDE_CHAT_MODEL = orig
  })

  it('falls back to claude-sonnet-4-6 when CLAUDE_CHAT_MODEL is unset', async () => {
    const orig = process.env.CLAUDE_CHAT_MODEL
    delete process.env.CLAUDE_CHAT_MODEL

    mockQuery.mockResolvedValueOnce(emptyChromaResult)
    mockStream.mockReturnValueOnce(makeStreamGen())

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    await collect(service.stream({ question: 'test?' }))

    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))

    process.env.CLAUDE_CHAT_MODEL = orig
  })

  it('handles chunks without startSeconds (timestamp is null)', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['vid1:0']],
      documents: [['no timestamp excerpt']],
      metadatas: [[{ videoId: 'vid1', title: 'V', channelTitle: 'C' }]],
      distances: [[0.1]],
    })
    mockStream.mockReturnValueOnce(makeStreamGen('See [1].'))

    const service = new ChatService(makeChroma(mockQuery), makeAnthropic(mockStream))
    const events = await collect(service.stream({ question: 'test?' }))

    const doneEvent = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(doneEvent.sources[0].timestamp).toBeNull()
  })
})
