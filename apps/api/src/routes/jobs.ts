import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { jobQueue } from '../services/jobQueue'

const router = Router()

router.post('/:id/retry', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid job id' })
    return
  }

  const failedJob = getDb().prepare(
    `SELECT id, type, payload, retryable FROM ingestion_jobs WHERE id = ? AND status = 'failed'`,
  ).get(id) as { id: number; type: string; payload: string; retryable: number | null } | undefined

  if (!failedJob) {
    res.status(404).json({ error: 'Failed job not found' })
    return
  }

  const force = (req.body as { force?: boolean })?.force === true
  if (failedJob.retryable === 0 && !force) {
    res.status(409).json({ error: 'Job is not retryable. Set force: true to override after correcting the environment.' })
    return
  }

  const jobId = jobQueue.createJob(failedJob.type, JSON.parse(failedJob.payload) as object)
  jobQueue.enqueue(jobId)
  res.status(202).json({ jobId, originalJobId: failedJob.id })
})

router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid job id' })
    return
  }

  const job = getDb().prepare(
    'SELECT id, type, status, stage, error_message, error_code, retryable, payload FROM ingestion_jobs WHERE id = ?'
  ).get(id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json(job)
})

export default router
