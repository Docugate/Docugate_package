#!/usr/bin/env node
// Simple bundler: reads pill/dist/ts/pill.js (compiled TS) and writes
// pill/dist/pill.js as a plain IIFE with no module machinery.
// No external dependencies — uses only Node built-ins.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'dist', 'ts', 'pill.js')
const outDir = join(root, 'dist')
const out = join(outDir, 'pill.js')

let code = readFileSync(src, 'utf8')

// Remove ES module export statements so it runs as a plain script.
// The two exported functions (matchRoute, suggestSelector) are kept in scope
// for the test file which imports them directly from pill.ts via the TS source.
code = code.replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
code = code.replace(/^export\s+(function|class|const|let|var)\s+/gm, '$1 ')

// Wrap in an IIFE so nothing leaks to global scope.
const banner = `// @docugate/pill v${getVersion(root)} — auto-generated, do not edit\n`
const iife = `${banner}(function(){\n'use strict';\n${code}\n})();\n`

mkdirSync(outDir, { recursive: true })
writeFileSync(out, iife, 'utf8')
console.log(`pill/dist/pill.js written (${iife.length} bytes)`)

function getVersion(pkgRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
