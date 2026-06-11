export interface TranscriptSegment {
  startSeconds?: number
  text: string
}

export interface TranscriptResult {
  videoId: string
  source: 'extractor' | 'manual'
  segments: TranscriptSegment[]
  plainText: string
}

export interface TranscriptProvider {
  getTranscript(videoId: string): Promise<TranscriptResult>
}

export class ManualTranscriptProvider implements TranscriptProvider {
  constructor(private text: string) {}

  async getTranscript(videoId: string): Promise<TranscriptResult> {
    return {
      videoId,
      source: 'manual',
      segments: [{ text: this.text }],
      plainText: this.text,
    }
  }
}

export class YouTubeTranscriptProvider implements TranscriptProvider {
  async getTranscript(videoId: string): Promise<TranscriptResult> {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const raw = await YoutubeTranscript.fetchTranscript(videoId)
    const segments: TranscriptSegment[] = raw.map(item => ({
      startSeconds: item.offset / 1000,
      text: item.text,
    }))
    return {
      videoId,
      source: 'extractor',
      segments,
      plainText: segments.map(s => s.text).join(' '),
    }
  }
}
