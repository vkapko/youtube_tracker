import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { SearchService } from '../services/search'
import type { SearchParams } from '../services/search'

const router = Router()

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TOP_K = 50

function isValidDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const [year, month, day] = s.split('-').map(Number)
  const d = new Date(s)
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  )
}

router.post('/', async (req: Request, res: Response) => {
  const { query, channelIds, fromDate, toDate, topK } = req.body as {
    query?: unknown
    channelIds?: unknown
    fromDate?: unknown
    toDate?: unknown
    topK?: unknown
  }

  if (!query || typeof query !== 'string' || query.trim() === '') {
    res.status(400).json({ error: 'query is required' })
    return
  }

  if (channelIds !== undefined) {
    if (
      !Array.isArray(channelIds) ||
      channelIds.length === 0 ||
      channelIds.some((id) => typeof id !== 'string' || id.trim() === '')
    ) {
      res.status(400).json({ error: 'channelIds must be a non-empty array of strings' })
      return
    }
  }

  if (fromDate !== undefined) {
    if (typeof fromDate !== 'string' || !isValidDate(fromDate)) {
      res.status(400).json({ error: 'fromDate must be a valid date in YYYY-MM-DD format' })
      return
    }
  }

  if (toDate !== undefined) {
    if (typeof toDate !== 'string' || !isValidDate(toDate)) {
      res.status(400).json({ error: 'toDate must be a valid date in YYYY-MM-DD format' })
      return
    }
  }

  if (
    fromDate !== undefined &&
    toDate !== undefined &&
    (fromDate as string) > (toDate as string)
  ) {
    res.status(400).json({ error: 'fromDate must not be after toDate' })
    return
  }

  let validatedTopK: number | undefined
  if (topK !== undefined) {
    const n = Number(topK)
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOP_K) {
      res.status(400).json({ error: `topK must be an integer between 1 and ${MAX_TOP_K}` })
      return
    }
    validatedTopK = n
  }

  const params: SearchParams = { query: query.trim() }
  if (channelIds !== undefined) params.channelIds = channelIds as string[]
  if (fromDate !== undefined) params.fromDate = fromDate as string
  if (toDate !== undefined) params.toDate = toDate as string
  if (validatedTopK !== undefined) params.topK = validatedTopK

  try {
    const db = getDb()
    const results = await new SearchService(db).search(params)
    res.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    res.status(503).json({ error: message })
  }
})

export default router
