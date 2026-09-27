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

/**
 * Fake IO that returns preset answers and records printed lines. Setup only
 * takes numbers, so the readable answers the tests are written with (role
 * names, y/n, a space's position in the list) are turned into the number of
 * the matching option for whichever question was printed last. The freshness
 * question is answered with its default, so older answer lists still line up.
 */
function fakeIO(answers = [], { isTTY = true } = {}) {
  const printed = []
  const asked = []
  const remaining = [...answers]
  let question = ''
  let optionCount = 0
  const toNumber = (answer) => {
    if (/^\d+$/.test(answer) && !question.startsWith('Which DocuGate space')) return answer
    if (question.startsWith('What is in this repository')) return String(['frontend', 'backend', 'both'].indexOf(answer) + 1)
    if (question.startsWith('Sign in')) return /^y/i.test(answer) ? '1' : '2'
    if (question.startsWith('Set up the tour')) return /^y/i.test(answer) ? '1' : '3'
    if (question.startsWith('Add the DocuGate pill')) return /^y/i.test(answer) ? '1' : '2'
    if (question.startsWith('Which DocuGate space')) return answer === 'skip' ? String(optionCount) : answer === 'create' ? '1' : String(Number(answer) + 1)
    return answer
  }
  return {
    io: {
      isTTY,
      ask(_q, defaultAnswer) {
        asked.push(question)
        if (question.startsWith('How often')) return Promise.resolve(defaultAnswer)
        const next = remaining.shift()
        return Promise.resolve(next !== undefined ? toNumber(next) : defaultAnswer)
      },
      print(line) {
        printed.push(line)
        if (/^ {4}\d+ {2}/.test(line)) optionCount++
        else if (/^ {2}\S/.test(line)) {
          question = line.trim()
          optionCount = 0
        }
      },
    },
    printed,
    asked,
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

/** Default no-op injections so tests never touch the real API or browser.
 * getSessionFn returns null user (not signed in); loginFn silently succeeds
 * so --yes tests don't fail when they auto-sign-in. */
const NO_AUTH = {
  getSessionFn: async () => ({ user: null }),
  loginFn: async () => ({ token: '' }),
  getRemoteFn: () => null,
}

test('frontend role: saves role, runs tour init, runs tour install', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n' })
  // answers: role=frontend, sign in=n, run tour=y, run install=y
  const { io, printed } = fakeIO(['frontend', 'n', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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
  // answers: role=backend, sign in=n
  const { io, printed } = fakeIO(['backend', 'n'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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
  // answers: role=both, sign in=n, run tour=y, run install=y
  const { io } = fakeIO(['both', 'n', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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
  // role already saved; sign in=n
  const { io, printed } = fakeIO(['n'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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

  const result = await initFlow(dir, { yes: true, io, runBob: bob.runBob, ...NO_AUTH })

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

  const result = await initFlow(dir, { yes: true, role: 'backend', io, runBob: bob.runBob, ...NO_AUTH })

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
  // answers: role=frontend, sign in=n, run tour=y, run install=y
  const { io, printed } = fakeIO(['frontend', 'n', 'y', 'y'])

  const result = await initFlow(dir, { io, runBob: missing, ...NO_AUTH })

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
  // answers: role=frontend, sign in=n, run tour=y, run install=n
  const { io, printed } = fakeIO(['frontend', 'n', 'y', 'n'])

  const result = await initFlow(dir, { io, runBob: failing, ...NO_AUTH })

  assert.ok(result.tourError)
  assert.ok(printed.some((l) => l.includes('docugate tour init')))
  assert.equal(result.installResult, undefined)
})

// ── Vite fixture gets pill installed ─────────────────────────────────────────

test('Vite project (index.html at root) gets pill installed during frontend init', async () => {
  const html = '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir)
  // answers: role=frontend, sign in=n, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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
  // answers: role=frontend, sign in=n, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

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
  // answers: role=frontend, sign in=n, skip tour, run install=y
  const { io } = fakeIO(['frontend', 'n', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

  assert.equal(result.installResult?.target, 'pages/_document.tsx')
  assert.equal(result.installResult?.action, 'inserted')
  const text = readFileSync(join(dir, 'pages/_document.tsx'), 'utf8')
  assert.ok(text.includes('{/* docugate:pill */}'))
})

// ── nothing found: prints paste line ─────────────────────────────────────────

test('no HTML found: install reports null and printed line shows pill script', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  // answers: role=frontend, sign in=n, skip tour, run install=y
  const { io, printed } = fakeIO(['frontend', 'n', 'n', 'y'])

  const result = await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })

  assert.equal(result.installResult?.target, null)
  assert.ok(printed.some((l) => l.includes('pill.js')))
})

// ── step-b: sign in and connect ───────────────────────────────────────────────

const SPACES_ONE = { spaces: [{ id: 's1', owner: 'alice', slug: 'my-app', name: 'My App' }] }
const SPACES_TWO = {
  spaces: [
    { id: 's1', owner: 'alice', slug: 'app1', name: 'App One' },
    { id: 's2', owner: 'alice', slug: 'app2', name: 'App Two' },
  ],
}
const SESSION_ALICE = { user: { githubLogin: 'alice' } }

const FAKE_REMOTE = (_root) => 'acme/my-app'

test('not signed in, TTY, user says yes to sign in: loginFn called, connectFn called', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const loginCalls = []
  const connectCalls = []
  // answers: role=backend, sign in=y, connect=1
  const { io, printed } = fakeIO(['backend', 'y', '1'])

  await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => ({ user: null }),
    loginFn: async (url) => { loginCalls.push(url); return { token: 'tok' } },
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async (id, repo, docsDir) => { connectCalls.push({ id, repo, docsDir }) },
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(loginCalls.length, 1)
  assert.equal(connectCalls.length, 1)
  assert.equal(connectCalls[0].id, 's1')
  assert.equal(connectCalls[0].repo, 'acme/my-app')
  assert.ok(printed.some((l) => l.includes('Signed in to DocuGate')))
})

test('not signed in, TTY, user says no to sign in: loginFn not called', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const loginCalls = []
  // answers: role=backend, sign in=n
  const { io } = fakeIO(['backend', 'n'])

  const result = await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => ({ user: null }),
    loginFn: async (url) => { loginCalls.push(url); return { token: 'tok' } },
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async () => {},
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(loginCalls.length, 0)
  assert.equal(result.connectError, undefined)
})

test('already signed in: skips sign-in question, goes to spaces', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const loginCalls = []
  const connectCalls = []
  // answers: role=backend, connect=1
  const { io } = fakeIO(['backend', '1'])

  await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async (url) => { loginCalls.push(url); return { token: 'tok' } },
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async (id, repo, docsDir) => { connectCalls.push({ id, repo, docsDir }) },
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(loginCalls.length, 0, 'login not called when already signed in')
  assert.equal(connectCalls.length, 1)
})

test('getSpacesFn throws: prints error and continues to tour steps', async () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\ntitle: Home\n---\n' })
  // answers: role=frontend, tour=y, install=y  (already signed in — no sign-in question)
  const { io, printed } = fakeIO(['frontend', 'y', 'y'])

  const result = await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async () => ({ token: 'tok' }),
    getSpacesFn: async () => { throw new Error('network error') },
    connectFn: async () => {},
    getRemoteFn: FAKE_REMOTE,
  })

  assert.ok(result.connectError, 'connectError set')
  assert.ok(result.connectError.includes('network error'))
  assert.ok(printed.some((l) => l.includes('warning')))
  // tour steps still ran
  assert.ok(result.tourResult)
  assert.ok(printed.some((l) => l.includes('Next: docugate tour serve')))
})

test('no spaces: offers to create one, and creates it', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  // answers: role=backend, space=1 (create)  (already signed in — no sign-in question)
  const { io, printed } = fakeIO(['backend', 'create'])
  const connectCalls = []
  const created = []

  await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async () => ({ token: 'tok' }),
    getSpacesFn: async () => ({ spaces: [] }),
    connectFn: async () => { connectCalls.push(1) },
    createSpaceFn: async (repo, name) => { created.push(repo); return { name, owner: 'alice', slug: 'app' } },
    getRemoteFn: FAKE_REMOTE,
    baseUrl: 'https://example.com',
  })

  assert.equal(connectCalls.length, 0)
  assert.equal(created.length, 1)
  assert.ok(printed.some((l) => l.includes('Create a new space')))
  assert.ok(printed.some((l) => l.includes('example.com/alice/app')))
})

test('setup never asks for a word: every question is a numbered choice', async () => {
  const dir = repo({ 'index.html': '<html><body></body></html>' })
  const bob = fakeBob(dir)
  const { io, printed } = fakeIO(['frontend', 'n', 'n', 'n'])
  await initFlow(dir, { io, runBob: bob.runBob, ...NO_AUTH })
  const prompts = printed.filter((l) => /^ {4}\d+ {2}/.test(l))
  assert.ok(prompts.length >= 9, 'role, sign-in, freshness, tour and pill each list numbered options')
  assert.ok(printed.some((l) => l.includes('IBM watsonx (coming soon)')))
  assert.equal(JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8')).freshness, 'daily')
})

test('inside a project already set up above, init points there instead of a second tour', async () => {
  const dir = repo({ '.git/HEAD': 'ref: refs/heads/main', 'docugate.json': '{"docsDir":"docs"}', 'docs/index.md': '# Hi', 'frontend/index.html': '<html></html>' })
  const { io, printed } = fakeIO([])
  const result = await initFlow(join(dir, 'frontend'), { io, ...NO_AUTH })
  assert.equal(result.alreadySetUp, dir)
  assert.ok(!existsSync(join(dir, 'frontend', 'docugate.json')), 'no second setup')
  assert.ok(printed.some((l) => l.includes('already set up')))
})

test('connectFn throws pro_required_sources: prints human message and continues', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  // answers: role=backend, connect=1  (already signed in)
  const { io, printed } = fakeIO(['backend', '1'])

  const result = await initFlow(dir, {
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async () => ({ token: 'tok' }),
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async () => { throw new Error('Connecting more than one repository to a space needs DocuGate Pro') },
    getRemoteFn: FAKE_REMOTE,
  })

  assert.ok(result.connectError, 'connectError set')
  assert.ok(result.connectError.includes('Pro'))
  assert.ok(printed.some((l) => l.includes('Pro')))
  // Setup still finished
  assert.ok(printed.some((l) => l.includes('Next: docugate tour serve')))
})

test('--yes with one space: connects automatically', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const connectCalls = []
  const { io } = fakeIO([], { isTTY: true })

  await initFlow(dir, {
    yes: true,
    role: 'backend',
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async () => ({ token: 'tok' }),
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async (id, repo, docsDir) => { connectCalls.push({ id, repo, docsDir }) },
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(connectCalls.length, 1)
  assert.equal(connectCalls[0].id, 's1')
})

test('--yes with multiple spaces: skips and prints list', async () => {
  const dir = repo({})
  const bob = fakeBob(dir)
  const connectCalls = []
  const { io, printed } = fakeIO([], { isTTY: true })

  await initFlow(dir, {
    yes: true,
    role: 'backend',
    io,
    runBob: bob.runBob,
    getSessionFn: async () => SESSION_ALICE,
    loginFn: async () => ({ token: 'tok' }),
    getSpacesFn: async () => SPACES_TWO,
    connectFn: async (id) => { connectCalls.push(id) },
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(connectCalls.length, 0)
  assert.ok(printed.some((l) => l.includes('--yes')))
})

test('CI (no TTY): prints login hint, does not ask about sign-in or spaces', async () => {
  const dir = repo({})
  const loginCalls = []
  const { io, printed } = fakeIO([], { isTTY: false })

  const result = await initFlow(dir, {
    io,
    loginFn: async (url) => { loginCalls.push(url); return { token: 'tok' } },
    getSessionFn: async () => ({ user: null }),
    getSpacesFn: async () => SPACES_ONE,
    connectFn: async () => {},
    getRemoteFn: FAKE_REMOTE,
  })

  assert.equal(loginCalls.length, 0)
  assert.equal(result.role, undefined)
  assert.ok(printed.some((l) => l.includes('docugate login')))
})
