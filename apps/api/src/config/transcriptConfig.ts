import { execFileSync as nodeExecFileSync } from 'child_process'
import path from 'path'
import type { TranscriptProvider } from '../services/transcript'
import { YouTubeTranscriptProvider } from '../services/transcript'
import { PythonTranscriptProvider } from '../services/pythonTranscriptProvider'

type ExecFn = (cmd: string, args: string[], opts: { encoding: string }) => string | Buffer

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export type TranscriptProviderName = 'python' | 'npm'

const DEFAULT_PREFERRED_LANGUAGES = ['en', 'en-US', 'en-GB']
const LANG_CODE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/

const ADAPTER_PATH = path.resolve(__dirname, '../../python/transcript_adapter.py')
const DEFAULT_PYTHON_EXECUTABLE = 'python3.12'

export interface TranscriptConfig {
  transcriptProvider: TranscriptProviderName
  pythonExecutable: string
  adapterPath: string
  preferredLanguages: string[]
}

export function parsePreferredLanguages(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_PREFERRED_LANGUAGES]

  if (raw.trim() === '') {
    throw new Error('TRANSCRIPT_PREFERRED_LANGUAGES must not be empty')
  }

  const entries = raw.split(',').map(e => e.trim())

  for (const entry of entries) {
    if (!entry) {
      throw new Error('TRANSCRIPT_PREFERRED_LANGUAGES contains an empty entry')
    }
    if (!LANG_CODE_PATTERN.test(entry)) {
      throw new Error(`Invalid language code in TRANSCRIPT_PREFERRED_LANGUAGES: "${entry}"`)
    }
  }

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry)) {
      throw new Error(`Duplicate language code in TRANSCRIPT_PREFERRED_LANGUAGES: "${entry}"`)
    }
    seen.add(entry)
  }

  return entries
}

export function validatePythonEnvironment(
  pythonExecutable: string,
  exec: ExecFn = nodeExecFileSync,
): void {
  let output: string
  try {
    output = String(exec(pythonExecutable, ['--version'], { encoding: 'utf8' }))
  } catch (err) {
    throw new Error(
      `Python executable not found or not executable: ${pythonExecutable}\n${err instanceof Error ? err.message : err}`,
    )
  }

  const match = output.trim().match(/^Python (\d+)\.(\d+)\./)
  if (!match || match[1] !== '3' || match[2] !== '12') {
    throw new Error(
      `Python 3.12 required but found: ${output.trim()} (executable: ${pythonExecutable})`,
    )
  }
}

export function buildTranscriptProvider(config: TranscriptConfig, exec?: ExecFn): TranscriptProvider {
  if (config.transcriptProvider === 'npm') {
    return new YouTubeTranscriptProvider()
  }

  validatePythonEnvironment(config.pythonExecutable, exec)

  return new PythonTranscriptProvider({
    pythonExecutable: config.pythonExecutable,
    adapterPath: config.adapterPath,
    preferredLanguages: config.preferredLanguages,
  })
}

export function loadTranscriptConfig(): TranscriptConfig {
  const providerEnv = process.env.TRANSCRIPT_PROVIDER ?? 'python'
  if (providerEnv !== 'python' && providerEnv !== 'npm') {
    throw new Error(`TRANSCRIPT_PROVIDER must be "python" or "npm", got: ${providerEnv}`)
  }

  return {
    transcriptProvider: providerEnv as TranscriptProviderName,
    pythonExecutable: process.env.PYTHON_EXECUTABLE ?? DEFAULT_PYTHON_EXECUTABLE,
    adapterPath: ADAPTER_PATH,
    preferredLanguages: parsePreferredLanguages(process.env.TRANSCRIPT_PREFERRED_LANGUAGES),
  }
}
