import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startTourServer } from '../dist/tour-server.js'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))
const TOUR_CHECK = join(FIXTURES, 'tour-check')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory pre-populated with the given files. */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-server-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

/** Copy the tour-check fixture to a temp directory so tests can write to it. */
function tempTourCheckRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-server-'))
  cpSync(TOUR_CHECK, dir, { recursive: true })
  return dir
}

/** Start a server on a random port; returns { port, close }. Registered for cleanup. */
async function startServer(root) {
  return startTourServer(root, 0)
}

/** Make a simple HTTP GET request. Returns { status, headers, body }. */
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, { headers: { host: 'localhost' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
  })
}

/** Make a PUT request with a JSON body. */
function put(port, path, body) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body)
    const req = http.request(`http://127.0.0.1:${port}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), host: 'localhost' },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(text)
  })
}

// ---------------------------------------------------------------------------
// GET /tour
// ---------------------------------------------------------------------------

test('GET /tour returns matching screen as JSON', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  const res = await get(server.port, '/tour?path=/invoices/INV-001')
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.route, '/invoices/:id')
  assert.equal(body.title, 'Invoice')
  assert.ok(Array.isArray(body.stops))
  assert.ok(body.stops.length > 0)
})

test('GET /tour returns 404 when no route matches', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  const res = await get(server.port, '/tour?path=/no/such/screen')
  assert.equal(res.status, 404)
  const body = JSON.parse(res.body)
  assert.equal(body.error, 'not found')
})

test('GET /tour defaults path to / when param is absent', async () => {
  const root = repo({
    '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n\n## Hero\ntarget: [data-tour="hero"]\ncode: src/Home.tsx\n\nThe homepage.\n',
  })
  const server = await startServer(root)
  after(() => server.close())

  const res = await get(server.port, '/tour')
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.route, '/')
})

// ---------------------------------------------------------------------------
// GET /events (SSE)
// ---------------------------------------------------------------------------

test('GET /events sends connected event on connect and change on file write', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  const received = []
  await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${server.port}/events`, { headers: { host: 'localhost' } }, (res) => {
      assert.equal(res.statusCode, 200)
      assert.ok(res.headers['content-type']?.includes('text/event-stream'))

      res.on('data', (chunk) => {
        received.push(chunk.toString())
        if (received.some((c) => c.includes('change'))) {
          req.destroy()
          resolve()
        }
      })
      res.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e) })

      // Write a file after a short delay to trigger the watcher.
      setTimeout(() => {
        writeFileSync(
          join(root, '.docugate', 'tour', 'home.md'),
          '---\nroute: /\ntitle: Home\n---\n\n## Hero\ntarget: [data-tour="hero"]\ncode: src/Home.tsx\n\nUpdated.\n',
        )
      }, 50)

      // Fail the test if no event arrives within 3 seconds.
      setTimeout(() => reject(new Error('SSE timeout: no change event received')), 3000)
    })
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e) })
  })

  assert.ok(received.some((c) => c.includes('connected')), 'should have received connected event')
  assert.ok(received.some((c) => c.includes('change')), 'should have received change event')
})

// ---------------------------------------------------------------------------
// PUT /stop
// ---------------------------------------------------------------------------

test('PUT /stop creates a new screen file when it does not exist', async () => {
  const root = repo({})
  const server = await startServer(root)
  after(() => server.close())

  const stop = {
    heading: 'Total',
    target: '[data-tour="invoice-total"]',
    data: 'GET /api/invoices/:id → total',
    code: 'frontend/src/screens/InvoiceDetail.tsx',
    prose: 'The amount due.',
  }
  const res = await put(server.port, '/stop', { route: '/invoices/:id', stop })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { ok: true })

  const filepath = join(root, '.docugate', 'tour', 'invoices-id.md')
  const text = readFileSync(filepath, 'utf8')
  assert.ok(text.includes('route: /invoices/:id'))
  assert.ok(text.includes('## Total'))
  assert.ok(text.includes('[data-tour="invoice-total"]'))
})

test('PUT /stop uses provided title when creating a new screen', async () => {
  const root = repo({})
  const server = await startServer(root)
  after(() => server.close())

  const stop = {
    heading: 'Hero',
    target: '[data-tour="hero"]',
    code: 'src/Home.tsx',
    prose: 'The hero section.',
  }
  const res = await put(server.port, '/stop', { route: '/', title: 'Homepage', stop })
  assert.equal(res.status, 200)
  const text = readFileSync(join(root, '.docugate', 'tour', 'home.md'), 'utf8')
  assert.ok(text.includes('title: Homepage'))
})

test('PUT /stop derives title from route when no title given', async () => {
  const root = repo({})
  const server = await startServer(root)
  after(() => server.close())

  const stop = {
    heading: 'Table',
    target: '[data-tour="invoice-table"]',
    code: 'src/Invoices.tsx',
    prose: 'The list.',
  }
  const res = await put(server.port, '/stop', { route: '/invoices', stop })
  assert.equal(res.status, 200)
  const text = readFileSync(join(root, '.docugate', 'tour', 'invoices.md'), 'utf8')
  assert.ok(text.includes('title: Invoices'))
})

test('PUT /stop updates a stop in the screen file that already exists', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  const updatedStop = {
    heading: 'Grand Total',
    target: '[data-tour="invoice-total"]',
    code: 'frontend/src/screens/InvoiceDetail.tsx',
    prose: 'Updated prose.',
  }
  const res = await put(server.port, '/stop', { route: '/invoices/:id', stop: updatedStop })
  assert.equal(res.status, 200)

  const filepath = join(root, '.docugate', 'tour', 'invoice-detail.md')
  const text = readFileSync(filepath, 'utf8')
  assert.ok(text.includes('## Grand Total'), 'heading should be updated')
  assert.ok(text.includes('Updated prose.'), 'prose should be updated')
  // Other stop must remain
  assert.ok(text.includes('Mark as paid'), 'other stops must be preserved')
})

test('PUT /stop appends a new stop to an existing file', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  const newStop = {
    heading: 'Download PDF',
    target: '[data-tour="download-pdf"]',
    code: 'frontend/src/screens/InvoiceDetail.tsx',
    prose: 'Downloads a PDF.',
  }
  const res = await put(server.port, '/stop', { route: '/invoices/:id', stop: newStop })
  assert.equal(res.status, 200)

  const filepath = join(root, '.docugate', 'tour', 'invoice-detail.md')
  const text = readFileSync(filepath, 'utf8')
  assert.ok(text.includes('## Download PDF'), 'new stop should be appended')
  assert.ok(text.includes('## Total'), 'existing stops must be preserved')
})

// ---------------------------------------------------------------------------
// GET /pill.js
// ---------------------------------------------------------------------------

test('GET /pill.js serves the built pill script', async () => {
  const root = repo({})
  const server = await startServer(root)
  after(() => server.close())

  const res = await get(server.port, '/pill.js')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/javascript')
  assert.ok(res.body.includes('DocugatePill') || res.body.includes('attachShadow'), 'pill.js should contain pill code')
})

// ---------------------------------------------------------------------------
// Security: origin and host checks
// ---------------------------------------------------------------------------

test('request with no Origin or Referer is allowed (curl-style)', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  // No Origin, no Referer, but Host is localhost
  const res = await get(server.port, '/tour?path=/invoices/1')
  assert.equal(res.status, 200)
})

test('request with localhost Origin is allowed', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  await new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${server.port}/tour?path=/invoices/1`,
      { headers: { host: 'localhost', origin: 'http://localhost:3000' } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          assert.equal(res.statusCode, 200)
          resolve()
        })
      },
    )
    req.on('error', reject)
  })
})

test('request with a foreign Origin is rejected with 403', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  await new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${server.port}/tour?path=/invoices/1`,
      { headers: { host: 'localhost', origin: 'https://evil.example.com' } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          assert.equal(res.statusCode, 403)
          resolve()
        })
      },
    )
    req.on('error', reject)
  })
})

test('request with a non-localhost Host is rejected with 403 (DNS rebinding)', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())

  await new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${server.port}/tour?path=/invoices/1`,
      { headers: { host: 'evil.example.com' } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          assert.equal(res.statusCode, 403)
          resolve()
        })
      },
    )
    req.on('error', reject)
  })
})

// ---------------------------------------------------------------------------
// CLI integration: tour serve
// ---------------------------------------------------------------------------

test('docugate tour serve starts with no tour yet, so the pill can add the first step', async () => {
  const dir = repo({})
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [CLI, 'tour', 'serve', '--port', '0'], { cwd: dir })
  const out = await new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error(`no output: ${text}`)), 8000)
    child.stdout.on('data', (d) => {
      text += d
      if (text.includes('No tour yet')) { clearTimeout(timer); resolve(text) }
    })
  })
  child.kill()
  assert.match(out, /Tour server/)
  assert.ok(existsSync(join(dir, '.docugate', 'tour')), 'the tour folder is created')
})

// ---------------------------------------------------------------------------
// CLI integration: tour export
// ---------------------------------------------------------------------------

test('docugate tour export writes a JSON file with all screens', () => {
  const root = tempTourCheckRepo()
  const outFile = join(root, 'tour-export.json')
  const result = spawnSync(process.execPath, [CLI, 'tour', 'export', outFile], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)

  const data = JSON.parse(readFileSync(outFile, 'utf8'))
  assert.ok(Array.isArray(data))
  assert.ok(data.length > 0)
  const screen = data[0]
  assert.ok(typeof screen.route === 'string')
  assert.ok(typeof screen.title === 'string')
  assert.ok(Array.isArray(screen.stops))
})

test('docugate tour export fails when no output file is given', () => {
  const root = tempTourCheckRepo()
  const result = spawnSync(process.execPath, [CLI, 'tour', 'export'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /tour export/)
})

test('docugate tour needs a subcommand', () => {
  const dir = repo({})
  const result = spawnSync(process.execPath, [CLI, 'tour'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
})

test('docugate tour rejects unknown subcommand', () => {
  const dir = repo({})
  const result = spawnSync(process.execPath, [CLI, 'tour', 'nope'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Unknown tour command "nope"/)
})

// ---------------------------------------------------------------------------
// Editing from the browser: preflight, corrections, removal, open in editor
// ---------------------------------------------------------------------------

test('OPTIONS answers the browser preflight so the pill can save', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())
  const res = await fetch(`http://localhost:${server.port}/stop`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT' },
  })
  assert.equal(res.status, 204)
  assert.match(res.headers.get('access-control-allow-methods'), /PUT/)
  assert.match(res.headers.get('access-control-allow-methods'), /DELETE/)
})

test('PUT /stop with previousTarget corrects a stop instead of adding a second one', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())
  const stop = { heading: 'Total', target: '[data-tour="grand-total"]', code: 'frontend/src/screens/InvoiceDetail.tsx', prose: 'Fixed.' }
  const res = await put(server.port, '/stop', { route: '/invoices/:id', stop, previousTarget: '[data-tour="invoice-total"]' })
  assert.equal(res.status, 200)
  const text = readFileSync(join(root, '.docugate', 'tour', 'invoice-detail.md'), 'utf8')
  assert.ok(text.includes('grand-total'))
  assert.ok(!text.includes('[data-tour="invoice-total"]'), 'the old stop is replaced, not kept')
  assert.equal(text.match(/^## Total$/gm).length, 1)
})

test('DELETE /stop removes one stop and keeps the others', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())
  const res = await fetch(`http://localhost:${server.port}/stop`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: '/invoices/:id', target: '[data-tour="invoice-total"]' }),
  })
  assert.equal(res.status, 200)
  const text = readFileSync(join(root, '.docugate', 'tour', 'invoice-detail.md'), 'utf8')
  assert.ok(!text.includes('invoice-total'))
  assert.ok(text.includes('Mark as paid'))
})

test('POST /open refuses files outside the repository', async () => {
  const root = tempTourCheckRepo()
  const server = await startServer(root)
  after(() => server.close())
  const res = await fetch(`http://localhost:${server.port}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '../../etc/passwd' }),
  })
  assert.equal(res.status, 404)
})

test('lineOf finds the element, and editorCommand follows the editor', async () => {
  const { lineOf, editorCommand } = await import('../dist/tour-server.js')
  assert.equal(lineOf('a\nb data-tour="x"\nc', 'data-tour="x"'), 2)
  assert.equal(lineOf('a\nb', 'missing'), 1)
  assert.equal(editorCommand({ DOCUGATE_EDITOR: 'webstorm' }), 'webstorm')
  assert.equal(editorCommand({ VSCODE_GIT_ASKPASS_NODE: 'C:/Program Files/cursor/Cursor.exe' }), 'cursor')
  assert.equal(editorCommand({}), 'code')
})
