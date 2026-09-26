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

function makeSnippet(port: number, jsx: boolean): string {
  if (jsx) {
    const url = `http://localhost:${port}/pill.js`
    return (
      `\n      ${JSX_OPEN}\n` +
      `      {process.env.NODE_ENV === 'development' && <script src="${url}" async />}\n` +
      `      ${JSX_CLOSE}`
    )
  }
  const url = `http://localhost:${port}/pill.js`
  return (
    `\n  ${HTML_OPEN}\n` +
    `  <script>if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){` +
    `var s=document.createElement('script');s.src='${url}';document.head.appendChild(s)}</script>\n` +
    `  ${HTML_CLOSE}`
  )
}

function insertSnippet(text: string, snippet: string, jsx: boolean): string {
  // Find the last </body> tag and insert immediately before it.
  const tag = '</body>'
  const idx = text.lastIndexOf(tag)
  if (idx !== -1) {
    return text.slice(0, idx) + snippet + '\n' + text.slice(idx)
  }
  if (jsx) {
    // _document.tsx may close with </html> instead of </body>
    const htmlIdx = text.lastIndexOf('</html>')
    if (htmlIdx !== -1) {
      return text.slice(0, htmlIdx) + snippet + '\n' + text.slice(htmlIdx)
    }
  }
  // Graceful fallback: append to end of file.
  return text + snippet + '\n'
}

function removeSnippet(text: string, open: string, close: string): string {
  const start = text.indexOf(open)
  if (start === -1) return text
  const end = text.indexOf(close, start)
  if (end === -1) return text
  // Also eat the leading newline before the open marker if present.
  const before = start > 0 && text[start - 1] === '\n' ? start - 1 : start
  return text.slice(0, before) + text.slice(end + close.length)
}

/**
 * Installs (or removes) the dev-only pill loader snippet in the app's entry
 * point. Safe to run multiple times — running it again when the snippet is
 * already present is a no-op.
 */
export function tourInstall(root: string, options: TourInstallOptions = {}): TourInstallResult {
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
