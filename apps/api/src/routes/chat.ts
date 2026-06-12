import { Router } from 'express'
import { ChatService } from '../services/chat.service'

const router = Router()

router.post('/', async (req, res) => {
  const { question, channelIds, topK } = req.body

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' })
  }

  if (channelIds !== undefined) {
    if (
      !Array.isArray(channelIds) ||
      channelIds.length === 0 ||
      channelIds.some((id: unknown) => typeof id !== 'string' || !id)
    ) {
      return res.status(400).json({ error: 'channelIds must be a non-empty array of strings' })
    }
  }

  if (topK !== undefined) {
    if (!Number.isInteger(topK) || topK <= 0 || topK > 20) {
      return res.status(400).json({ error: 'topK must be an integer between 1 and 20' })
    }
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const service = new ChatService()

  try {
    for await (const event of service.stream({
      question: question.trim(),
      channelIds,
      topK,
    })) {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
      if (event.type === 'done') {
        res.end()
        return
      }
    }
    res.end()
  } catch (err) {
    console.error('[chat] stream error:', err)
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred while processing your request.' })}\n\n`)
    res.end()
  }
})

export default router
