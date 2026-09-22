import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_KEYS } from './rules.js'
import type { DocugateConfig } from './rules.js'

export type Issue = { file?: string; message: string }

export type LoadedConfig = {
  /** Whether docugate.json exists at all. It is optional. */
  found: boolean
  config: DocugateConfig
  docsDir: string
  errors: Issue[]
  warnings: Issue[]
}

const FILE = 'docugate.json'

/**
 * Reads docugate.json from the repository root, where DocuGate looks for it.
 *
 * The server treats an unreadable file as if it were not there and falls back
 * to `docs/`, silently. That is the right thing for a reader and the wrong
 * thing for the person who wrote the file, so here it is an error.
 */
export function loadConfig(root: string): LoadedConfig {
  const path = join(root, FILE)
  const errors: Issue[] = []
  const warnings: Issue[] = []

  if (!existsSync(path)) {
    return { found: false, config: {}, docsDir: 'docs', errors, warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push({
      file: FILE,
      message: `is not valid JSON (${(error as Error).message}). DocuGate ignores it and reads docs/.`,
    })
    return { found: true, config: {}, docsDir: 'docs', errors, warnings }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push({ file: FILE, message: 'must be a JSON object.' })
    return { found: true, config: {}, docsDir: 'docs', errors, warnings }
  }

  const config = parsed as Record<string, unknown>

  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push({ file: FILE, message: `has an unknown key "${key}", which DocuGate ignores.` })
    }
  }
  if (config.docsDir !== undefined && typeof config.docsDir !== 'string') {
    errors.push({ file: FILE, message: '"docsDir" must be a string, like "docs".' })
  }
  if (config.title !== undefined && typeof config.title !== 'string') {
    errors.push({ file: FILE, message: '"title" must be a string.' })
  }
  if (
    config.sidebar !== undefined &&
    (!Array.isArray(config.sidebar) || config.sidebar.some((s) => typeof s !== 'string'))
  ) {
    errors.push({ file: FILE, message: '"sidebar" must be a list of file and folder names.' })
  }

  const docsDir =
    typeof config.docsDir === 'string' ? config.docsDir.replace(/^\/|\/$/g, '') || 'docs' : 'docs'

  return { found: true, config: config as DocugateConfig, docsDir, errors, warnings }
}

export const CONFIG_FILE = FILE
