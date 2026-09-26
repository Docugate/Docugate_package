import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, realpathSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTours, matchRoute, parseTourFile, routeToFilename, serializeTourFile } from './tour.js'
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
  if (!match) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  sendJson(res, 200, { route: match.route, title: match.title, stops: match.stops })
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
  let body: { route: string; title?: string; stop: TourStop }
  try {
    const text = await readBody(req)
    body = JSON.parse(text) as { route: string; title?: string; stop: TourStop }
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }

  const { route, title: bodyTitle, stop } = body
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

  // Upsert: find by target and update, or append.
  const idx = tour.stops.findIndex((s) => s.target === stop.target)
  if (idx >= 0) {
    tour.stops[idx] = stop
  } else {
    tour.stops.push(stop)
  }

  writeFileSync(filepath, serializeTourFile(tour))
  sendJson(res, 200, { ok: true })
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

      if (req.method === 'GET' && path === '/tour') {
        handleGetTour(req, res, root)
      } else if (req.method === 'GET' && path === '/events') {
        handleGetEvents(req, res, root)
      } else if (req.method === 'PUT' && path === '/stop') {
        handlePutStop(req, res, root).catch((err: Error) => {
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
