import PQueue from 'p-queue'
import { getDb } from '../db/database'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface JobRow {
  id: number
  type: string
  status: JobStatus
  stage: string | null
  payload: string
  error_message: string | null
  error_code: string | null
  retryable: number | null
}

type SetStage = (stage: string) => void
type WorkerFn = (job: JobRow, setStage: SetStage) => Promise<void>
type WorkerMap = Record<string, WorkerFn>

export class JobQueue {
  private queue: PQueue
  private workers: WorkerMap

  constructor(workers: WorkerMap) {
    this.queue = new PQueue({ concurrency: 3 })
    this.workers = workers
  }

  createJob(type: string, payload: object): number {
    const result = getDb()
      .prepare(`INSERT INTO ingestion_jobs (type, status, payload) VALUES (?, 'queued', ?)`)
      .run(type, JSON.stringify(payload))
    return Number(result.lastInsertRowid)
  }

  enqueue(jobId: number): void {
    this.queue.add(() => this.runJob(jobId))
  }

  rehydrate(): void {
    const db = getDb()
    db.prepare(`UPDATE ingestion_jobs SET status = 'queued' WHERE status = 'running'`).run()
    const pending = db.prepare(
      `SELECT * FROM ingestion_jobs WHERE status = 'queued'`
    ).all() as JobRow[]
    for (const job of pending) {
      this.enqueue(job.id)
    }
  }

  waitForIdle(): Promise<void> {
    return this.queue.onIdle()
  }

  private async runJob(jobId: number): Promise<void> {
    const db = getDb()
    db.prepare(`UPDATE ingestion_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(jobId)
    const job = db.prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(jobId) as JobRow

    try {
      const worker = this.workers[job.type]
      if (!worker) throw new Error(`No worker registered for job type: ${job.type}`)
      const setStage = (stage: string) => {
        db.prepare(`UPDATE ingestion_jobs SET stage = ?, updated_at = datetime('now') WHERE id = ?`).run(stage, jobId)
      }
      await worker(job, setStage)
      db.prepare(`UPDATE ingestion_jobs SET status = 'completed', stage = NULL, updated_at = datetime('now') WHERE id = ?`).run(jobId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      db.prepare(
        `UPDATE ingestion_jobs SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(message, jobId)
    }
  }
}

export let jobQueue = new JobQueue({})

export function setJobQueue(q: JobQueue): void {
  jobQueue = q
}
