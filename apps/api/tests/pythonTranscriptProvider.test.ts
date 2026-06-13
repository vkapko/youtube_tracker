import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PythonTranscriptProvider, PythonTranscriptError } from '../src/services/pythonTranscriptProvider'
import type { SubprocessRunner, SubprocessResult } from '../src/services/pythonTranscriptProvider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  pythonExecutable: '/usr/bin/python3',
  adapterPath: '/app/transcript_adapter.py',
  preferredLanguages: ['en', 'en-US'],
  timeoutMs: 5000,
}

function makeRunner(result: Partial<SubprocessResult>): SubprocessRunner {
  return {
    run: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      stdoutTruncated: false,
      ...result,
    }),
  }
}

function okResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: 'ok',
    protocolVersion: '1',
    videoId: 'dQw4w9WgXcQ',
    languageCode: 'en',
    languageName: 'English',
    isGenerated: false,
    segments: [
      { text: 'Hello world', startSeconds: 0.0, durationSeconds: 2.5 },
    ],
    ...overrides,
  })
}

function errorResponse(errorCode: string, retryable: boolean, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: 'error',
    protocolVersion: '1',
    errorCode,
    retryable,
    message: `Error: ${errorCode}`,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Successful acquisition
// ---------------------------------------------------------------------------

describe('PythonTranscriptProvider — successful acquisition', () => {
  it('returns status ok with a TranscriptResult from the adapter response', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse({ videoId: 'dQw4w9WgXcQ' }) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    const result = await provider.getTranscript('dQw4w9WgXcQ')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.transcript.videoId).toBe('dQw4w9WgXcQ')
    expect(result.transcript.source).toBe('extractor')
    expect(result.transcript.languageCode).toBe('en')
    expect(result.transcript.languageName).toBe('English')
    expect(result.transcript.isGenerated).toBe(false)
  })

  it('maps adapter segments to TranscriptSegment with durationSeconds', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse() })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    const result = await provider.getTranscript('dQw4w9WgXcQ')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.transcript.segments).toEqual([
      { text: 'Hello world', startSeconds: 0.0, durationSeconds: 2.5 },
    ])
  })

  it('builds plainText by joining segment texts with single space', async () => {
    const stdout = okResponse({
      segments: [
        { text: 'First', startSeconds: 0.0, durationSeconds: 1.0 },
        { text: 'Second', startSeconds: 1.0, durationSeconds: 1.0 },
      ],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    const result = await provider.getTranscript('dQw4w9WgXcQ')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.transcript.plainText).toBe('First Second')
  })

  it('sends preferredLanguages from config in the request', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse() })
    const provider = new PythonTranscriptProvider(
      { ...DEFAULT_CONFIG, preferredLanguages: ['en-GB', 'en'] },
      runner,
    )
    await provider.getTranscript('dQw4w9WgXcQ')
    const request = JSON.parse((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][2] as string)
    expect(request.preferredLanguages).toEqual(['en-GB', 'en'])
  })

  it('sends protocolVersion 1 in the request', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse() })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    await provider.getTranscript('dQw4w9WgXcQ')
    const request = JSON.parse((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][2] as string)
    expect(request.protocolVersion).toBe('1')
    expect(request.videoId).toBe('dQw4w9WgXcQ')
  })
})

// ---------------------------------------------------------------------------
// Unavailable outcomes (non-throwing)
// ---------------------------------------------------------------------------

describe('PythonTranscriptProvider — unavailable outcomes', () => {
  const UNAVAILABLE_CODES = [
    'transcripts_disabled',
    'no_requested_transcript',
    'empty_transcript',
    'video_unavailable',
  ] as const

  for (const code of UNAVAILABLE_CODES) {
    it(`returns status unavailable for errorCode ${code}`, async () => {
      const runner = makeRunner({ exitCode: 1, stdout: errorResponse(code, false) })
      const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
      const result = await provider.getTranscript('dQw4w9WgXcQ')
      expect(result.status).toBe('unavailable')
      if (result.status !== 'unavailable') return
      expect(result.reason).toBe(code)
    })
  }
})

// ---------------------------------------------------------------------------
// Thrown errors (failed outcomes)
// ---------------------------------------------------------------------------

describe('PythonTranscriptProvider — thrown errors', () => {
  it('throws PythonTranscriptError for request_blocked (retryable)', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: errorResponse('request_blocked', true) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    await expect(provider.getTranscript('dQw4w9WgXcQ')).rejects.toThrow(PythonTranscriptError)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect(err).toBeInstanceOf(PythonTranscriptError)
      expect((err as PythonTranscriptError).code).toBe('request_blocked')
      expect((err as PythonTranscriptError).retryable).toBe(true)
    }
  })

  it('throws PythonTranscriptError for dependency_error (non-retryable)', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: errorResponse('dependency_error', false) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect(err).toBeInstanceOf(PythonTranscriptError)
      expect((err as PythonTranscriptError).code).toBe('dependency_error')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })

  it('throws adapter_protocol_error for exit 0 with status error', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: errorResponse('dependency_error', false) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })

  it('throws adapter_protocol_error for exit 1 with status ok', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: okResponse() })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error for exit 2', async () => {
    const runner = makeRunner({ exitCode: 2, stdout: '' })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })

  it('throws adapter_protocol_error for malformed JSON stdout', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: 'not json' })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error for empty stdout on exit 1', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: '' })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error when languageCode is missing from ok response', async () => {
    const stdout = okResponse({ languageCode: undefined })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error when languageCode is not in preferredLanguages', async () => {
    const stdout = okResponse({ languageCode: 'fr' })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error when videoId in response does not match request', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse({ videoId: 'DIFFERENT_ID' }) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_protocol_error for unknown error code (does not trust retryable)', async () => {
    const runner = makeRunner({ exitCode: 1, stdout: errorResponse('completely_unknown_code', true) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })

  it('throws adapter_protocol_error when retryable field mismatches error code matrix', async () => {
    // request_blocked should be retryable=true; false is a mismatch
    const runner = makeRunner({ exitCode: 1, stdout: errorResponse('request_blocked', false) })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('throws adapter_output_too_large (non-retryable) when stdout is truncated', async () => {
    const runner = makeRunner({ exitCode: 0, stdout: okResponse(), stdoutTruncated: true })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_output_too_large')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })

  it('throws adapter_timeout (retryable) when process timed out', async () => {
    const runner = makeRunner({ timedOut: true, exitCode: null as unknown as number, stdout: '' })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_timeout')
      expect((err as PythonTranscriptError).retryable).toBe(true)
    }
  })

  it('throws adapter_spawn_error (non-retryable) when process fails to spawn', async () => {
    const runner = makeRunner({ exitCode: null as unknown as number, stdout: '', timedOut: false, stdoutTruncated: false })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_spawn_error')
      expect((err as PythonTranscriptError).retryable).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Segment validation
// ---------------------------------------------------------------------------

describe('PythonTranscriptProvider — segment validation', () => {
  it('rejects response with negative startSeconds as adapter_protocol_error', async () => {
    const stdout = okResponse({
      segments: [{ text: 'Hello', startSeconds: -1.0, durationSeconds: 1.0 }],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('rejects response with non-finite startSeconds as adapter_protocol_error', async () => {
    const stdout = okResponse({
      segments: [{ text: 'Hello', startSeconds: Infinity, durationSeconds: 1.0 }],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('rejects response with decreasing startSeconds as adapter_protocol_error', async () => {
    const stdout = okResponse({
      segments: [
        { text: 'First', startSeconds: 5.0, durationSeconds: 1.0 },
        { text: 'Second', startSeconds: 2.0, durationSeconds: 1.0 },
      ],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })

  it('accepts equal startSeconds (valid per spec)', async () => {
    const stdout = okResponse({
      segments: [
        { text: 'A', startSeconds: 1.0, durationSeconds: 1.0 },
        { text: 'B', startSeconds: 1.0, durationSeconds: 1.5 },
      ],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    const result = await provider.getTranscript('dQw4w9WgXcQ')
    expect(result.status).toBe('ok')
  })

  it('rejects response with multiline segment text as adapter_protocol_error', async () => {
    const stdout = okResponse({
      segments: [{ text: 'Line one\nLine two', startSeconds: 0.0, durationSeconds: 1.0 }],
    })
    const runner = makeRunner({ exitCode: 0, stdout })
    const provider = new PythonTranscriptProvider(DEFAULT_CONFIG, runner)
    try {
      await provider.getTranscript('dQw4w9WgXcQ')
    } catch (err) {
      expect((err as PythonTranscriptError).code).toBe('adapter_protocol_error')
    }
  })
})
