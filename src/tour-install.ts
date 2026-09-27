import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// `docugate tour install` inserts a development-only pill loader into the
// app's HTML or Next.js layout entry point. The snippet is wrapped in comment
// markers so it can be found and removed again without touching anything else.

export const DEFAULT_PORT = 4178

// Comment markers used as anchors — one pair for HTML files, one for TSX/JSX.
const HTML_OPEN = '<!-- docugate:pill -->'
const HTML_CLOSE = '<!-- /docugate:pill -->'
const JSX_OPEN = '{/* docugate:pill */}'
const JSX_CLOSE = '{/* /docugate:pill */}'

/** Candidate paths checked in order. The first one that exists wins. */
export const CANDIDATES = [
  'app/layout.tsx',
  'app/layout.jsx',
  'src/app/layout.tsx',
  'src/app/layout.jsx',
  'pages/_document.tsx',
  'pages/_document.jsx',
  'index.html',
  'frontend/index.html',
  'client/index.html',
  'web/index.html',
  'app/index.html',
  'public/index.html',
] as const

export type TourInstallOptions = {
  port?: number
  remove?: boolean
}

export type TourInstallResult = {
  /** The file that was (or would be) modified; null when nothing was found. */
  target: string | null
  action: 'inserted' | 'removed' | 'already' | 'none'
  /** The npm script that now starts the tour server with the app, e.g. predev. */
  hook?: string
  hookAction?: 'inserted' | 'removed' | 'already' | 'none'
}

/** What the app's own start script runs first, so the tour server comes up with it. */
export const SERVE_HOOK = 'docugate tour serve --background'

/**
 * Adds `docugate tour serve --background` as the `predev` script (or
 * `prestart`, for apps started with npm start), so running the project the
 * usual way also starts the tour server. npm runs pre-scripts by itself, on
 * every platform. An existing pre-script keeps running first. Only this
 * repository's package.json, and only its scripts, are touched.
 */
export function installStartHook(root: string, options: TourInstallOptions = {}): { hook?: string; action: TourInstallResult['action'] } {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return { action: 'none' }
  const text = readFileSync(path, 'utf8')
  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(text)
  } catch {
    return { action: 'none' }
  }
  const scripts = pkg.scripts ?? {}
  const base = scripts.dev ? 'dev' : scripts.start ? 'start' : null
  if (!base) return { action: 'none' }
  const hook = `pre${base}`
  const port = options.port ?? DEFAULT_PORT
  const command = port === DEFAULT_PORT ? SERVE_HOOK : `${SERVE_HOOK} --port ${port}`
  const existing = scripts[hook]

  if (options.remove) {
    if (!existing?.includes(SERVE_HOOK)) return { hook, action: 'already' }
    const rest = existing
      .split('&&')
      .map((part) => part.trim())
      .filter((part) => !part.startsWith(SERVE_HOOK))
      .join(' && ')
    if (rest) scripts[hook] = rest
    else delete scripts[hook]
  } else {
    if (existing?.includes(SERVE_HOOK)) return { hook, action: 'already' }
    scripts[hook] = existing ? `${existing} && ${command}` : command
  }
  pkg.scripts = scripts
  const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? '  '
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(path, JSON.stringify(pkg, null, indent).replace(/\n/g, eol) + eol)
  return { hook, action: options.remove ? 'removed' : 'inserted' }
}

/** Returns true if any candidate file already contains the pill snippet. */
export function hasPillSnippet(root: string): boolean {
  for (const rel of CANDIDATES) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    if (text.includes(HTML_OPEN) || text.includes(JSX_OPEN)) return true
  }
  return false
}

function isJsx(rel: string): boolean {
  return rel.endsWith('.tsx') || rel.endsWith('.jsx')
}

/** The snippet as lines, without indentation: the file it lands in decides that. */
function makeSnippet(port: number, jsx: boolean): string[] {
  const url = `http://localhost:${port}/pill.js`
  if (jsx) {
    return [JSX_OPEN, `{process.env.NODE_ENV === 'development' && <script src="${url}" async />}`, JSX_CLOSE]
  }
  return [
    HTML_OPEN,
    `<script>if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){` +
      `var s=document.createElement('script');s.src='${url}';document.head.appendChild(s)}</script>`,
    HTML_CLOSE,
  ]
}

/**
 * Inserts the snippet on its own lines just above the closing tag, indented one
 * step deeper than it and with the file's own line endings, so the diff a
 * developer reviews is three clean added lines.
 */
function insertSnippet(text: string, lines: string[], jsx: boolean): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let idx = text.lastIndexOf('</body>')
  // _document.tsx may close with </html> instead of </body>
  if (idx === -1 && jsx) idx = text.lastIndexOf('</html>')
  if (idx === -1) {
    // Graceful fallback: append to end of file.
    const end = text.endsWith('\n') ? '' : eol
    return text + end + lines.join(eol) + eol
  }

  const lineStart = text.lastIndexOf('\n', idx - 1) + 1
  const indent = text.slice(lineStart, idx)
  if (/^[ \t]*$/.test(indent)) {
    const block = lines.map((line) => `${indent}  ${line}`).join(eol) + eol
    return text.slice(0, lineStart) + block + text.slice(lineStart)
  }
  // The tag shares its line with other markup: keep it on that line.
  return text.slice(0, idx) + lines.join(eol) + eol + text.slice(idx)
}

/** Removes the whole marked block, including the lines it sat on. */
function removeSnippet(text: string, open: string, close: string): string {
  const start = text.indexOf(open)
  if (start === -1) return text
  const end = text.indexOf(close, start)
  if (end === -1) return text
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const from = /^[ \t]*$/.test(text.slice(lineStart, start)) ? lineStart : start
  let to = end + close.length
  if (text[to] === '\r') to++
  if (text[to] === '\n') to++
  return text.slice(0, from) + text.slice(to)
}

/**
 * Installs (or removes) the dev-only pill loader snippet in the app's entry
 * point. Safe to run multiple times — running it again when the snippet is
 * already present is a no-op.
 */
export function tourInstall(root: string, options: TourInstallOptions = {}): TourInstallResult {
  const result = installSnippet(root, options)
  const started = installStartHook(root, options)
  return { ...result, hook: started.hook, hookAction: started.action }
}

function installSnippet(root: string, options: TourInstallOptions): TourInstallResult {
  const port = options.port ?? DEFAULT_PORT
  const remove = options.remove ?? false

  for (const rel of CANDIDATES) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue

    const jsx = isJsx(rel)
    const open = jsx ? JSX_OPEN : HTML_OPEN
    const close = jsx ? JSX_CLOSE : HTML_CLOSE

    const original = readFileSync(abs, 'utf8')
    const hasMarker = original.includes(open)

    if (remove) {
      if (!hasMarker) return { target: rel, action: 'already' }
      const updated = removeSnippet(original, open, close)
      writeFileSync(abs, updated)
      return { target: rel, action: 'removed' }
    }

    if (hasMarker) return { target: rel, action: 'already' }

    const snippet = makeSnippet(port, jsx)
    const updated = insertSnippet(original, snippet, jsx)
    writeFileSync(abs, updated)
    return { target: rel, action: 'inserted' }
  }

  return { target: null, action: 'none' }
}

/** The one-line snippet to paste manually when no entry point was found. */
export function pillSnippetLine(port: number): string {
  return `<script>if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){var s=document.createElement('script');s.src='http://localhost:${port}/pill.js';document.head.appendChild(s)}</script>`
}
