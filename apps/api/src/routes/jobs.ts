import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'

const router = Router()

router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid job id' })
    return
  }

  const job = getDb().prepare(
    'SELECT id, type, status, stage, error_message, payload FROM ingestion_jobs WHERE id = ?'
  ).get(id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json(job)
})

export default router
