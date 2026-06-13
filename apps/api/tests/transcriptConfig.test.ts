import { describe, it, expect } from 'vitest'
import {
  parsePreferredLanguages,
  buildTranscriptProvider,
  validatePythonEnvironment,
} from '../src/config/transcriptConfig'
import { YouTubeTranscriptProvider } from '../src/services/transcript'
import { PythonTranscriptProvider } from '../src/services/pythonTranscriptProvider'

// ---------------------------------------------------------------------------
// Fake exec helpers — no module mocking needed
// ---------------------------------------------------------------------------

function fakeExec(output: string) {
  return (_cmd: string, _args: string[], _opts: object) => output
}

function throwingExec(msg: string) {
  return (_cmd: string, _args: string[], _opts: object): never => {
    throw new Error(msg)
  }
}

// ---------------------------------------------------------------------------
// parsePreferredLanguages
// ---------------------------------------------------------------------------

describe('parsePreferredLanguages', () => {
  it('parses comma-separated list', () => {
    expect(parsePreferredLanguages('en,en-US,en-GB')).toEqual(['en', 'en-US', 'en-GB'])
  })

  it('trims whitespace from each entry', () => {
    expect(parsePreferredLanguages(' en , en-US , en-GB ')).toEqual(['en', 'en-US', 'en-GB'])
  })

  it('returns default list when input is undefined', () => {
    expect(parsePreferredLanguages(undefined)).toEqual(['en', 'en-US', 'en-GB'])
  })

  it('throws on empty string', () => {
    expect(() => parsePreferredLanguages('')).toThrow()
  })

  it('throws on list with empty entry', () => {
    expect(() => parsePreferredLanguages('en,,en-US')).toThrow()
  })

  it('throws on list with duplicate entries', () => {
    expect(() => parsePreferredLanguages('en,en-US,en')).toThrow()
  })

  it('throws on syntactically invalid language code (space in code)', () => {
    expect(() => parsePreferredLanguages('en,en US')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// validatePythonEnvironment
// ---------------------------------------------------------------------------

describe('validatePythonEnvironment', () => {
  it('succeeds when Python 3.12 is found', () => {
    expect(() =>
      validatePythonEnvironment('/usr/bin/python3.12', fakeExec('Python 3.12.3\n')),
    ).not.toThrow()
  })

  it('throws when Python executable is not found', () => {
    expect(() =>
      validatePythonEnvironment('/no/such/python', throwingExec('ENOENT')),
    ).toThrow()
  })

  it('throws when Python version is not 3.12.x', () => {
    expect(() =>
      validatePythonEnvironment('/usr/bin/python3', fakeExec('Python 3.14.0\n')),
    ).toThrow(/3\.12/)
  })

  it('throws for Python 3.11', () => {
    expect(() =>
      validatePythonEnvironment('/usr/bin/python3', fakeExec('Python 3.11.5\n')),
    ).toThrow(/3\.12/)
  })
})

// ---------------------------------------------------------------------------
// buildTranscriptProvider
// ---------------------------------------------------------------------------

describe('buildTranscriptProvider', () => {
  it('returns PythonTranscriptProvider when TRANSCRIPT_PROVIDER=python', () => {
    const provider = buildTranscriptProvider(
      {
        transcriptProvider: 'python',
        pythonExecutable: '/usr/bin/python3.12',
        adapterPath: '/app/transcript_adapter.py',
        preferredLanguages: ['en'],
      },
      fakeExec('Python 3.12.0\n'),
    )
    expect(provider).toBeInstanceOf(PythonTranscriptProvider)
  })

  it('returns YouTubeTranscriptProvider when TRANSCRIPT_PROVIDER=npm', () => {
    const provider = buildTranscriptProvider({
      transcriptProvider: 'npm',
      pythonExecutable: '/usr/bin/python3.12',
      adapterPath: '/app/transcript_adapter.py',
      preferredLanguages: ['en'],
    })
    expect(provider).toBeInstanceOf(YouTubeTranscriptProvider)
  })

  it('skips Python validation when TRANSCRIPT_PROVIDER=npm', () => {
    const badExec = throwingExec('should not be called')
    const provider = buildTranscriptProvider(
      {
        transcriptProvider: 'npm',
        pythonExecutable: '/nonexistent',
        adapterPath: '/nonexistent',
        preferredLanguages: ['en'],
      },
      badExec,
    )
    expect(provider).toBeInstanceOf(YouTubeTranscriptProvider)
  })

  it('throws on startup when Python validation fails for python provider', () => {
    expect(() =>
      buildTranscriptProvider(
        {
          transcriptProvider: 'python',
          pythonExecutable: '/nonexistent',
          adapterPath: '/app/adapter.py',
          preferredLanguages: ['en'],
        },
        throwingExec('not found'),
      ),
    ).toThrow()
  })
})
