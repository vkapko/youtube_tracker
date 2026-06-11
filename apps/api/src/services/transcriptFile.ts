import fs from 'node:fs/promises'
import path from 'node:path'
import type { TranscriptResult } from './transcript'

export interface SaveTranscriptOptions {
  channelId: string
  videoId: string
  title: string
  channelName: string
  publishedAt: string
  result: TranscriptResult
  dataDir?: string
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function buildFileContent(opts: SaveTranscriptOptions): string {
  const { videoId, title, channelName, publishedAt, result } = opts
  const url = `https://www.youtube.com/watch?v=${videoId}`

  const header = [
    `Title: ${title}`,
    `Channel: ${channelName}`,
    `Video ID: ${videoId}`,
    `URL: ${url}`,
    `Published: ${publishedAt}`,
  ].join('\n')

  const body = result.segments
    .map(seg =>
      seg.startSeconds !== undefined
        ? `[${formatTimestamp(seg.startSeconds)}] ${seg.text}`
        : seg.text,
    )
    .join('\n')

  return `${header}\n\n${body}\n`
}

function parseTimestamp(ts: string): number {
  const [h, m, s] = ts.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

export interface ParsedSegment {
  startSeconds?: number
  text: string
}

export function parseTranscriptFile(content: string): ParsedSegment[] {
  const lines = content.split('\n')
  const blankIdx = lines.findIndex(l => l === '')
  const bodyLines = (blankIdx >= 0 ? lines.slice(blankIdx + 1) : lines).filter(l => l.trim())
  return bodyLines.map(line => {
    const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (.+)$/)
    if (match) return { startSeconds: parseTimestamp(match[1]), text: match[2] }
    return { text: line }
  })
}

export async function readTranscript(filePath: string): Promise<ParsedSegment[]> {
  const content = await fs.readFile(filePath, 'utf8')
  return parseTranscriptFile(content)
}

export async function saveTranscript(opts: SaveTranscriptOptions): Promise<string> {
  const dataDir = opts.dataDir ?? 'data'
  const dir = path.join(dataDir, 'transcripts', opts.channelId)
  await fs.mkdir(dir, { recursive: true })

  const filePath = path.join(dir, `${opts.videoId}.txt`)
  await fs.writeFile(filePath, buildFileContent(opts), 'utf8')
  return filePath
}
