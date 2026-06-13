export interface TranscriptSegment {
  startSeconds?: number
  durationSeconds?: number
  text: string
}

export interface TranscriptResult {
  videoId: string
  source: 'extractor' | 'manual'
  segments: TranscriptSegment[]
  plainText: string
  languageCode?: string
  languageName?: string
  isGenerated?: boolean
}

export type UnavailableReason =
  | 'transcripts_disabled'
  | 'no_requested_transcript'
  | 'empty_transcript'
  | 'video_unavailable'

export type TranscriptAcquisitionResult =
  | { status: 'ok'; transcript: TranscriptResult }
  | { status: 'unavailable'; reason: UnavailableReason }

export interface TranscriptProvider {
  getTranscript(videoId: string): Promise<TranscriptAcquisitionResult>
}

export class ManualTranscriptProvider implements TranscriptProvider {
  constructor(private text: string) {}

  async getTranscript(videoId: string): Promise<TranscriptAcquisitionResult> {
    return {
      status: 'ok',
      transcript: {
        videoId,
        source: 'manual',
        segments: [{ text: this.text }],
        plainText: this.text,
      },
    }
  }
}

export class YouTubeTranscriptProvider implements TranscriptProvider {
  async getTranscript(videoId: string): Promise<TranscriptAcquisitionResult> {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const raw = await YoutubeTranscript.fetchTranscript(videoId)
    const segments: TranscriptSegment[] = raw.map(item => ({
      startSeconds: item.offset / 1000,
      text: item.text,
    }))
    return {
      status: 'ok',
      transcript: {
        videoId,
        source: 'extractor',
        segments,
        plainText: segments.map(s => s.text).join(' '),
      },
    }
  }
}
