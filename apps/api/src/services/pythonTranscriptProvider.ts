import { spawn } from 'child_process'
import { Readable } from 'stream'
import type { TranscriptProvider, TranscriptAcquisitionResult, TranscriptSegment, UnavailableReason } from './transcript'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class PythonTranscriptError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'PythonTranscriptError'
  }
}

export interface SubprocessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  stdoutTruncated: boolean
}

export interface SubprocessRunner {
  run(
    executable: string,
    args: string[],
    stdin: string,
    timeoutMs: number,
    maxStdoutBytes: number,
    maxStderrBytes: number,
  ): Promise<SubprocessResult>
}

export interface PythonTranscriptProviderConfig {
  pythonExecutable: string
  adapterPath: string
  preferredLanguages: string[]
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '1'
const MAX_STDOUT_BYTES = 10 * 1024 * 1024 // 10 MiB
const MAX_STDERR_BYTES = 64 * 1024         // 64 KiB
const DEFAULT_TIMEOUT_MS = 30_000

const UNAVAILABLE_CODES = new Set<string>([
  'transcripts_disabled',
  'no_requested_transcript',
  'empty_transcript',
  'video_unavailable',
])

const RETRYABLE_CODES = new Set<string>(['request_blocked', 'provider_error'])

const ALL_ERROR_CODES = new Set<string>([
  ...UNAVAILABLE_CODES,
  ...RETRYABLE_CODES,
  'invalid_request',
  'dependency_error',
  'runtime_error',
])

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PythonTranscriptProvider implements TranscriptProvider {
  private readonly runner: SubprocessRunner
  private readonly timeoutMs: number

  constructor(
    private readonly config: PythonTranscriptProviderConfig,
    runner?: SubprocessRunner,
  ) {
    this.runner = runner ?? new DefaultSubprocessRunner()
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async getTranscript(videoId: string): Promise<TranscriptAcquisitionResult> {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      videoId,
      preferredLanguages: this.config.preferredLanguages,
    }

    const result = await this.runner.run(
      this.config.pythonExecutable,
      [this.config.adapterPath],
      JSON.stringify(request),
      this.timeoutMs,
      MAX_STDOUT_BYTES,
      MAX_STDERR_BYTES,
    )

    return this.interpretResult(videoId, result)
  }

  private interpretResult(videoId: string, result: SubprocessResult): TranscriptAcquisitionResult {
    if (result.timedOut) {
      throw new PythonTranscriptError('Adapter process timed out', 'adapter_timeout', true)
    }

    if (result.stdoutTruncated) {
      throw new PythonTranscriptError(
        'Adapter stdout exceeded size limit',
        'adapter_output_too_large',
        false,
      )
    }

    if (result.exitCode === null) {
      throw new PythonTranscriptError('Adapter process failed to spawn', 'adapter_spawn_error', false)
    }

    // exit 2 can never carry a trusted protocol response
    if (result.exitCode === 2) {
      throw new PythonTranscriptError(
        'Adapter exited with invocation failure (exit 2)',
        'adapter_protocol_error',
        false,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new PythonTranscriptError(
        'Adapter produced non-JSON stdout',
        'adapter_protocol_error',
        false,
      )
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new PythonTranscriptError('Adapter response is not an object', 'adapter_protocol_error', false)
    }

    const response = parsed as Record<string, unknown>

    if (response.status === 'ok') {
      if (result.exitCode !== 0) {
        throw new PythonTranscriptError(
          'Adapter emitted status ok but exited non-zero',
          'adapter_protocol_error',
          false,
        )
      }
      return this.parseOkResponse(videoId, response)
    }

    if (response.status === 'error') {
      if (result.exitCode !== 1) {
        throw new PythonTranscriptError(
          'Adapter emitted status error but did not exit 1',
          'adapter_protocol_error',
          false,
        )
      }
      return this.parseErrorResponse(response)
    }

    throw new PythonTranscriptError(
      `Adapter response has unexpected status: ${response.status}`,
      'adapter_protocol_error',
      false,
    )
  }

  private parseOkResponse(
    requestedVideoId: string,
    response: Record<string, unknown>,
  ): TranscriptAcquisitionResult {
    if (response.videoId !== requestedVideoId) {
      throw new PythonTranscriptError(
        `Adapter returned videoId ${response.videoId} but requested ${requestedVideoId}`,
        'adapter_protocol_error',
        false,
      )
    }

    const rawSegments = response.segments
    if (!Array.isArray(rawSegments)) {
      throw new PythonTranscriptError('Adapter response missing segments array', 'adapter_protocol_error', false)
    }

    const segments = rawSegments.map((s, i) => this.validateSegment(s, i))
    this.validateSegmentOrder(segments)

    if (typeof response.languageCode !== 'string') {
      throw new PythonTranscriptError('Adapter ok response missing languageCode', 'adapter_protocol_error', false)
    }
    const languageCode = response.languageCode
    if (!this.config.preferredLanguages.includes(languageCode)) {
      throw new PythonTranscriptError(
        `Adapter returned languageCode "${languageCode}" not in preferredLanguages`,
        'adapter_protocol_error',
        false,
      )
    }
    const languageName = typeof response.languageName === 'string' ? response.languageName : undefined
    if (typeof response.isGenerated !== 'boolean') {
      throw new PythonTranscriptError('Adapter ok response missing isGenerated', 'adapter_protocol_error', false)
    }
    const isGenerated = response.isGenerated

    return {
      status: 'ok',
      transcript: {
        videoId: requestedVideoId,
        source: 'extractor',
        segments,
        plainText: segments.map(s => s.text).join(' '),
        languageCode,
        languageName,
        isGenerated,
      },
    }
  }

  private validateSegment(raw: unknown, index: number): TranscriptSegment {
    if (!raw || typeof raw !== 'object') {
      throw new PythonTranscriptError(`Segment ${index} is not an object`, 'adapter_protocol_error', false)
    }
    const seg = raw as Record<string, unknown>

    if (typeof seg.text !== 'string') {
      throw new PythonTranscriptError(`Segment ${index} text is not a string`, 'adapter_protocol_error', false)
    }
    if (seg.text.includes('\n') || seg.text.includes('\r')) {
      throw new PythonTranscriptError(`Segment ${index} text contains newline`, 'adapter_protocol_error', false)
    }

    const start = Number(seg.startSeconds)
    const duration = Number(seg.durationSeconds)

    if (!isFinite(start) || start < 0) {
      throw new PythonTranscriptError(
        `Segment ${index} startSeconds is invalid: ${seg.startSeconds}`,
        'adapter_protocol_error',
        false,
      )
    }
    if (!isFinite(duration) || duration < 0) {
      throw new PythonTranscriptError(
        `Segment ${index} durationSeconds is invalid: ${seg.durationSeconds}`,
        'adapter_protocol_error',
        false,
      )
    }

    return { text: seg.text, startSeconds: start, durationSeconds: duration }
  }

  private validateSegmentOrder(segments: TranscriptSegment[]): void {
    for (let i = 1; i < segments.length; i++) {
      if ((segments[i].startSeconds ?? 0) < (segments[i - 1].startSeconds ?? 0)) {
        throw new PythonTranscriptError(
          `Segments are not in non-decreasing order at index ${i}`,
          'adapter_protocol_error',
          false,
        )
      }
    }
  }

  private parseErrorResponse(response: Record<string, unknown>): TranscriptAcquisitionResult {
    const errorCode = response.errorCode
    if (typeof errorCode !== 'string') {
      throw new PythonTranscriptError('Adapter error response missing errorCode', 'adapter_protocol_error', false)
    }

    if (!ALL_ERROR_CODES.has(errorCode)) {
      throw new PythonTranscriptError(
        `Unknown adapter error code: ${errorCode}`,
        'adapter_protocol_error',
        false,
      )
    }

    const adapterRetryable = response.retryable
    const expectedRetryable = RETRYABLE_CODES.has(errorCode)
    if (adapterRetryable !== expectedRetryable) {
      throw new PythonTranscriptError(
        `Adapter retryable mismatch for ${errorCode}: expected ${expectedRetryable}, got ${adapterRetryable}`,
        'adapter_protocol_error',
        false,
      )
    }

    const message = typeof response.message === 'string' && response.message.trim()
      ? response.message
      : errorCode

    if (UNAVAILABLE_CODES.has(errorCode)) {
      return { status: 'unavailable', reason: errorCode as UnavailableReason }
    }

    throw new PythonTranscriptError(message, errorCode, expectedRetryable)
  }
}

// ---------------------------------------------------------------------------
// Default subprocess runner
// ---------------------------------------------------------------------------

class DefaultSubprocessRunner implements SubprocessRunner {
  async run(
    executable: string,
    args: string[],
    stdin: string,
    timeoutMs: number,
    maxStdoutBytes: number,
    maxStderrBytes: number,
  ): Promise<SubprocessResult> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stdoutBufs: Buffer[] = []
      let stdoutBytes = 0
      let stdoutTruncated = false

      let stderrBufs: Buffer[] = []
      let stderrBytes = 0

      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000)
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutTruncated) return
        if (stdoutBytes + chunk.length > maxStdoutBytes) {
          stdoutTruncated = true
          child.kill('SIGTERM')
          setTimeout(() => child.kill('SIGKILL'), 2000)
          return
        }
        stdoutBufs.push(chunk)
        stdoutBytes += chunk.length
      })

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < maxStderrBytes) {
          const take = Math.min(chunk.length, maxStderrBytes - stderrBytes)
          stderrBufs.push(chunk.slice(0, take))
          stderrBytes += take
        }
      })

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        resolve({
          exitCode,
          stdout: stdoutTruncated ? '' : Buffer.concat(stdoutBufs).toString('utf8'),
          stderr: Buffer.concat(stderrBufs).toString('utf8'),
          timedOut,
          stdoutTruncated,
        })
      })

      child.on('error', () => {
        clearTimeout(timer)
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, stdoutTruncated: false })
      })

      child.stdin.write(stdin)
      child.stdin.end()
    })
  }
}
