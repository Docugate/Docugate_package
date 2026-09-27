import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, watch, writeFileSync } from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTours, matchRoute, parseTourFile, routeToFilename, serializeTourFile } from './tour.js'
import { loadConfig } from './config.js'
import type { Tour, TourStop } from './tour.js'

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Returns true when the host string is localhost or 127.0.0.1 (any port). */
function isLocalhost(host: string): boolean {
  const hostname = host.split(':')[0]
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * Check every request for DNS-rebinding safety:
 * - The Host header must be localhost or 127.0.0.1.
 * - If an Origin header is present, it must be a localhost origin.
 * - If an Origin is absent but a Referer is present, the Referer host must be localhost.
 * - Requests with neither Origin nor Referer (e.g. curl) are allowed.
 *
 * Returns true when the request should be accepted.
 */
function isAllowed(req: IncomingMessage): boolean {
  const host = req.headers['host'] ?? ''
  if (host && !isLocalhost(host)) return false

  const origin = req.headers['origin']
  if (origin) {
    try {
      return isLocalhost(new URL(origin).hostname)
    } catch {
      return false
    }
  }

  const referer = req.headers['referer']
  if (referer) {
    try {
      return isLocalhost(new URL(referer).hostname)
    } catch {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(text)
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(body)
}

// ---------------------------------------------------------------------------
// Route title derivation
// ---------------------------------------------------------------------------

/**
 * Derive a title from a route when no title is provided in the request body.
 * Takes the last non-param segment and title-cases it.
 * /invoices/:id → "Invoices", / → "Home"
 */
function titleFromRoute(route: string): string {
  const segments = route.split('/').filter((s) => s && !s.startsWith(':'))
  if (!segments.length) return 'Home'
  const last = segments[segments.length - 1]
  return last.charAt(0).toUpperCase() + last.slice(1)
}

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleGetTour(req: IncomingMessage, res: ServerResponse, root: string): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.searchParams.get('path') ?? '/'
  const tours = loadTours(root)
  const match = tours.find((t) => matchRoute(t.route, pathname))
  const docsUrl = publishedDocsUrl(root)
  if (!match) {
    sendJson(res, 404, { error: 'not found', docsUrl })
    return
  }
  sendJson(res, 200, { route: match.route, title: match.title, file: match.file, docsUrl, stops: match.stops })
}

/** Where this project's docs are published, from the space docugate init saved. */
export function publishedDocsUrl(root: string): string | undefined {
  const space = loadConfig(root).config.space
  if (!space || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(space)) return undefined
  return `${process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'}/${space}`
}

function handleGetEvents(req: IncomingMessage, res: ServerResponse, root: string): void {
  const tourDir = join(root, '.docugate', 'tour')

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  // Send a "connected" event immediately so the client knows the stream is live.
  res.write('data: connected\n\n')

  let closed = false

  let watcher: ReturnType<typeof watch> | null = null
  if (existsSync(tourDir)) {
    // Use realpathSync to resolve any 8.3 short names on Windows, which
    // would otherwise trigger a libuv assertion in fs-event.c.
    const watchDir = realpathSync.native(tourDir)
    watcher = watch(watchDir, () => {
      if (!closed) res.write('data: change\n\n')
    })
  }

  req.on('close', () => {
    closed = true
    // Defer close to avoid calling watcher.close() from within a watcher
    // callback, which can cause a libuv assertion on Windows.
    setImmediate(() => watcher?.close())
  })
}

async function handlePutStop(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  let body: { route: string; title?: string; stop: TourStop; previousTarget?: string }
  try {
    const text = await readBody(req)
    body = JSON.parse(text) as { route: string; title?: string; stop: TourStop }
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }

  const { route, title: bodyTitle, stop, previousTarget } = body
  if (!route || !stop) {
    sendJson(res, 400, { error: 'body must have route and stop' })
    return
  }

  const tourDir = join(root, '.docugate', 'tour')
  mkdirSync(tourDir, { recursive: true })

  // Prefer an existing file whose route matches, so we preserve files that
  // were named differently from what routeToFilename would derive.
  const existing = loadTours(root).find((t) => t.route === route)
  const filename = existing?.file
    ? existing.file.replace(/^\.docugate\/tour\//, '')
    : routeToFilename(route)
  const filepath = join(tourDir, filename)
  const relPath = `.docugate/tour/${filename}`

  let tour: Tour
  if (existing) {
    const text = readFileSync(filepath, 'utf8')
    tour = parseTourFile(text, relPath)
  } else {
    tour = {
      route,
      title: bodyTitle ?? titleFromRoute(route),
      stops: [],
    }
  }

  // Upsert: find the stop being edited (by its old target when the edit
  // changed it) and update it in place, or append a new one.
  const idx = tour.stops.findIndex((s) => s.target === (previousTarget ?? stop.target))
  if (idx >= 0) {
    tour.stops[idx] = stop
  } else {
    tour.stops.push(stop)
  }

  writeFileSync(filepath, serializeTourFile(tour))
  sendJson(res, 200, { ok: true })
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.docugate', '.bob', 'coverage', '.vercel'])
const CODE_FILE = /\.(tsx|jsx|ts|js|vue|svelte|html|astro)$/

/**
 * The repository file that renders an element with this data-tour value, so
 * the pill fills in "the file that shows it" instead of asking. A file with
 * data-tour="value" wins over one that only passes the value along as a prop.
 */
export function findTourFile(root: string, value: string): string | undefined {
  const exact = new RegExp(`data-tour=["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`)
  const quoted = new RegExp(`["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`)
  let fallback: string | undefined
  let seen = 0
  const walk = (dir: string): string | undefined => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++seen > 20000) return undefined
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const found = walk(abs)
        if (found) return found
      } else if (CODE_FILE.test(entry.name)) {
        const text = readFileSync(abs, 'utf8')
        const rel = relative(root, abs).split('\\').join('/')
        if (exact.test(text)) return rel
        if (!fallback && quoted.test(text)) fallback = rel
      }
    }
    return undefined
  }
  return walk(root) ?? fallback
}

function handleFind(req: IncomingMessage, res: ServerResponse, root: string): void {
  const value = new URL(req.url ?? '/', 'http://localhost').searchParams.get('value') ?? ''
  const path = value ? findTourFile(root, value) : undefined
  if (!path) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  sendJson(res, 200, { path })
}

/** DELETE /stop { route, target }: removes one stop, leaving the rest of the file as it was. */
async function handleDeleteStop(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  let body: { route?: string; target?: string }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }
  const existing = loadTours(root).find((t) => t.route === body.route)
  if (!existing?.file || !body.target) {
    sendJson(res, 404, { error: 'no such stop' })
    return
  }
  const filepath = join(root, existing.file)
  const tour = parseTourFile(readFileSync(filepath, 'utf8'), existing.file)
  const before = tour.stops.length
  tour.stops = tour.stops.filter((s) => s.target !== body.target)
  if (tour.stops.length === before) {
    sendJson(res, 404, { error: 'no such stop' })
    return
  }
  writeFileSync(filepath, serializeTourFile(tour))
  sendJson(res, 200, { ok: true })
}

/**
 * The editor `docugate tour serve` was started from, as the command that opens
 * a file at a line. DOCUGATE_EDITOR wins; otherwise the integrated terminal's
 * environment says which VS Code family editor it is.
 */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DOCUGATE_EDITOR) return env.DOCUGATE_EDITOR
  const hint = `${env.VSCODE_GIT_ASKPASS_NODE ?? ''} ${env.VSCODE_CWD ?? ''} ${env.CURSOR_TRACE_ID ? 'cursor' : ''}`.toLowerCase()
  if (hint.includes('cursor')) return 'cursor'
  if (hint.includes('windsurf')) return 'windsurf'
  if (hint.includes('insiders')) return 'code-insiders'
  return 'code'
}

/** The 1-based line of the first occurrence of `find` in `text`, or 1. */
export function lineOf(text: string, find?: string): number {
  if (!find) return 1
  const index = text.split(/\r?\n/).findIndex((line) => line.includes(find))
  return index >= 0 ? index + 1 : 1
}

/**
 * POST /open { path, find? }: opens a file of this repository in the editor,
 * at the line that contains `find` (the element's data-tour value), so "Code"
 * in the pill jumps straight to the element. Only files inside the repository.
 */
async function handleOpen(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  let body: { path?: string; find?: string }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }
  const abs = resolve(root, body.path ?? '')
  const rel = relative(root, abs)
  if (!body.path || rel.startsWith('..') || isAbsolute(rel) || !existsSync(abs) || /["%^&|<>`$]/.test(abs)) {
    sendJson(res, 404, { error: 'no such file in this repository' })
    return
  }
  const line = lineOf(readFileSync(abs, 'utf8'), body.find)
  const command = editorCommand()
  // One command string, the path quoted: editor launchers are .cmd files on
  // Windows, which only run through a shell.
  const child = spawn(`${command} -g "${abs}:${line}"`, { shell: true, stdio: 'ignore' })
  child.on('error', () => sendJson(res, 501, { error: `could not run ${command}` }))
  child.on('exit', (code) => {
    if (res.headersSent) return
    if (code === 0) sendJson(res, 200, { ok: true, line })
    else sendJson(res, 501, { error: `could not run ${command}`, line })
  })
}

function handleGetPill(res: ServerResponse): void {
  // pill/dist/pill.js is resolved relative to this package's root directory.
  // import.meta.url points at dist/tour-server.js at runtime, so go up one level.
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
  const pillPath = join(pkgRoot, 'pill', 'dist', 'pill.js')
  if (!existsSync(pillPath)) {
    sendText(res, 404, 'pill.js not built yet')
    return
  }
  const content = readFileSync(pillPath)
  res.writeHead(200, { 'Content-Type': 'application/javascript' })
  res.end(content)
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface TourServer {
  port: number
  close(): void
}

export function startTourServer(root: string, port: number): Promise<TourServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!isAllowed(req)) {
        sendText(res, 403, 'Forbidden')
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname

      // The pill runs on the app's own port, so a JSON PUT from it is a
      // cross-origin request: the browser asks first, and must get a yes.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        })
        res.end()
        return
      }

      if (req.method === 'GET' && path === '/tour') {
        handleGetTour(req, res, root)
      } else if (req.method === 'GET' && path === '/events') {
        handleGetEvents(req, res, root)
      } else if (req.method === 'PUT' && path === '/stop') {
        handlePutStop(req, res, root).catch((err: Error) => {
          sendJson(res, 500, { error: err.message })
        })
      } else if (req.method === 'DELETE' && path === '/stop') {
        handleDeleteStop(req, res, root).catch((err: Error) => {
          sendJson(res, 500, { error: err.message })
        })
      } else if (req.method === 'GET' && path === '/find') {
        handleFind(req, res, root)
      } else if (req.method === 'POST' && path === '/open') {
        handleOpen(req, res, root).catch((err: Error) => {
          sendJson(res, 500, { error: err.message })
        })
      } else if (req.method === 'GET' && path === '/pill.js') {
        handleGetPill(res)
      } else {
        sendText(res, 404, 'Not found')
      }
    })

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const boundPort = addr && typeof addr === 'object' ? addr.port : port
      resolve({
        port: boundPort,
        close: () => server.close(),
      })
    })

    server.on('error', reject)
  })
}
