import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initFlow } from '../dist/init.js'

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-init-flow-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

/** Fake IO that returns preset answers and records printed lines. */
function fakeIO(answers = [], { isTTY = true } = {}) {
  const printed = []
  const remaining = [...answers]
  return {
    io: {
      isTTY,
      ask(_q, defaultAnswer) {
        const next = remaining.shift()
        return Promise.resolve(next !== undefined ? next : defaultAnswer)
      },
      print(line) { printed.push(line) },
    },
    printed,
  }
}

const ok = (extra = {}) => ({
  status: 0,
  stderr: '',
  stdout: JSON.stringify({ status: 'completed', stats: { task_id: 't1', duration_ms: 42000, session_costs: 0.4 }, last_message: 'done', ...extra }),
})

/** Bob stand-in that writes files and records calls. */
function fakeBob(root, write = {}) {
  const calls = []
  const runBob = (args) => {
    if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' }
    calls.push(args)
    for (const [path, content] of Object.entries(write)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    return ok()
  }
  return { calls, runBob }
}

// ── frontend role ─────────────────────────────────────────────────────────────

test('frontend role: saves role, runs tour init, runs tour install', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n' })
  // answers: role=frontend, run tour=y, run install=y
  const { io, printed } = fakeIO(['frontend', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.role, 'frontend')
  const config = JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8'))
  assert.equal(config.role, 'frontend')
  assert.ok(result.tourResult, 'tourResult set')
  assert.ok(result.tourResult.added.length > 0, 'tour files added')
  assert.ok(result.installResult, 'installResult set')
  assert.equal(result.installResult.action, 'inserted')
  assert.ok(printed.some((l) => l.includes('Next: docugate tour serve')))
})

// ── backend role ──────────────────────────────────────────────────────────────

test('backend role: saves role, skips tour and install, prints skip message', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  // answers: role=backend
  const { io, printed } = fakeIO(['backend'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.role, 'backend')
  const config = JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8'))
  assert.equal(config.role, 'backend')
  assert.equal(result.tourResult, undefined)
  assert.equal(result.installResult, undefined)
  assert.equal(bob.calls.length, 0, 'Bob not called for backend')
  assert.ok(printed.some((l) => l.includes('backend role')))
})

// ── both role ─────────────────────────────────────────────────────────────────

test('both role: runs tour init and tour install', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n' })
  // answers: role=both, run tour=y, run install=y
  const { io } = fakeIO(['both', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.role, 'both')
  assert.ok(result.tourResult)
  assert.ok(result.installResult)
  assert.equal(result.installResult.action, 'inserted')
})

// ── second run skips role question ────────────────────────────────────────────

test('second run skips role question when role already in config', async () => {
  const dir = repo({
    'docugate.json': JSON.stringify({ docsDir: 'docs', title: 'App', role: 'backend' }),
    'docs/index.md': '# App\n',
  })
  const bob = fakeBob(dir)
  // no answers needed — role already saved
  const { io, printed } = fakeIO([])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.role, 'backend')
  // role still backend in config
  const config = JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8'))
  assert.equal(config.role, 'backend')
  assert.ok(printed.some((l) => l.includes('backend role')))
})

// ── --yes flag ────────────────────────────────────────────────────────────────

test('--yes accepts defaults without asking: role becomes both, tour+install run', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n' })
  const { io, printed } = fakeIO([], { isTTY: true })

  const result = await initFlow(dir, { yes: true, io, runBob: bob.runBob })

  assert.equal(result.role, 'both')
  assert.ok(result.tourResult, 'Bob ran')
  assert.ok(result.installResult, 'install ran')
  assert.equal(result.installResult.action, 'inserted')
  assert.ok(printed.some((l) => l.includes('Next: docugate tour serve')))
})

test('--role with --yes uses the provided role', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const { io } = fakeIO([], { isTTY: true })

  const result = await initFlow(dir, { yes: true, role: 'backend', io, runBob: bob.runBob })

  assert.equal(result.role, 'backend')
  assert.equal(bob.calls.length, 0)
})

// ── CI / no terminal ──────────────────────────────────────────────────────────

test('CI (no TTY): writes docugate.json without role, prints guidance, no tour', async () => {
  const dir = repo({})
  const { io, printed } = fakeIO([], { isTTY: false })

  const result = await initFlow(dir, { io })

  // role is undefined — not guessed
  assert.equal(result.role, undefined)
  assert.equal(result.tourResult, undefined)
  assert.equal(result.installResult, undefined)
  // docugate.json was created (by base init), but no role key
  const config = JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8'))
  assert.equal(config.role, undefined)
  assert.ok(printed.some((l) => l.includes('--role')))
})

// ── Bob failure does not stop setup ──────────────────────────────────────────

test('Bob missing: prints warning, still runs install, finishes with summary', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  // Bob always reports as missing
  const missing = () => ({ status: 1, stdout: '', stderr: "'bob' is not recognized as an internal or external command," })
  // answers: role=frontend, run tour=y, run install=y
  const { io, printed } = fakeIO(['frontend', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: missing })

  assert.ok(result.tourError, 'tourError set')
  assert.ok(printed.some((l) => l.toLowerCase().includes('bob shell')))
  // install still ran
  assert.ok(result.installResult)
  assert.equal(result.installResult.action, 'inserted')
  // summary printed
  assert.ok(printed.some((l) => l.includes('Next: docugate tour serve')))
})

test('Bob generic failure: prints warning with retry hint', async () => {
  const dir = repo({})
  const failing = (args) => {
    if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' }
    return { status: 5, stdout: '', stderr: 'Internal error' }
  }
  // answers: role=frontend, run tour=y, run install=n
  const { io, printed } = fakeIO(['frontend', 'y', 'n'])

  const result = await initFlow(dir, { io, runBob: failing })

  assert.ok(result.tourError)
  assert.ok(printed.some((l) => l.includes('docugate tour init')))
  assert.equal(result.installResult, undefined)
})

// ── Vite fixture gets pill installed ─────────────────────────────────────────

test('Vite project (index.html at root) gets pill installed during frontend init', async () => {
  const html = '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir)
  // answers: role=frontend, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.installResult?.target, 'index.html')
  assert.equal(result.installResult?.action, 'inserted')
  const text = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.ok(text.includes('<!-- docugate:pill -->'))
})

// ── Next.js app router fixture ───────────────────────────────────────────────

const LAYOUT_TSX = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`

test('Next.js app router (app/layout.tsx) gets pill installed', async () => {
  const dir = repo({ 'app/layout.tsx': LAYOUT_TSX })
  const bob = fakeBob(dir)
  // answers: role=frontend, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.installResult?.target, 'app/layout.tsx')
  assert.equal(result.installResult?.action, 'inserted')
  const text = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
  assert.ok(text.includes('{/* docugate:pill */}'))
})

// ── Next.js pages router fixture ─────────────────────────────────────────────

const DOCUMENT_TSX = `import Document, { Html, Head, Main, NextScript } from 'next/document'
export default class MyDocument extends Document {
  render() {
    return (
      <Html>
        <Head />
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
`

test('Next.js pages router (_document.tsx) gets pill installed', async () => {
  const dir = repo({ 'pages/_document.tsx': DOCUMENT_TSX })
  const bob = fakeBob(dir)
  // answers: role=frontend, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.installResult?.target, 'pages/_document.tsx')
  assert.equal(result.installResult?.action, 'inserted')
  const text = readFileSync(join(dir, 'pages/_document.tsx'), 'utf8')
  assert.ok(text.includes('{/* docugate:pill */}'))
})

// ── nothing found: prints paste line ─────────────────────────────────────────

test('no HTML found: install reports null and printed line shows pill script', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  // answers: role=frontend, skip tour, run install=y
  const { io, printed } = fakeIO(['frontend', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob })

  assert.equal(result.installResult?.target, null)
  assert.ok(printed.some((l) => l.includes('pill.js')))
})

// ── sign-in placeholder always printed ───────────────────────────────────────

test('sign-in coming-soon line is always printed', async () => {
  const dir = repo({})
  // answers: role=backend
  const { io, printed } = fakeIO(['backend'])

  await initFlow(dir, { io })

  assert.ok(printed.some((l) => l.includes('[coming soon]')))
})
