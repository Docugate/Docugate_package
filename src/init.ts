import { createInterface } from 'node:readline'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { CONFIG_FILE, loadConfig } from './config.js'
import type { RunBob } from './tour-init.js'
import { tourInit, BobMissingError, BobKeyMissingError, readBobKey, saveBobKey } from './tour-init.js'
import { tourInstall, pillSnippetLine, DEFAULT_PORT } from './tour-install.js'
import type { TourInitResult } from './tour-init.js'
import type { TourInstallResult } from './tour-install.js'
import { login, loadCredentials } from './auth.js'
import type { LoginOptions } from './auth.js'
import type { Space } from './api.js'

export type InitResult = { created: string[]; kept: string[]; docsDir: string }

/**
 * Sets a repository up for DocuGate: a docugate.json, and a first page if the
 * docs folder has none. Never overwrites — running it twice is harmless, and
 * running it in a repository that already has docs only adds what is missing.
 */
export function init(root: string, opts: { dir?: string; title?: string } = {}): InitResult {
  const created: string[] = []
  const kept: string[] = []
  const existing = loadConfig(root)
  const docsDir = (opts.dir ?? existing.docsDir).replace(/^\/|\/$/g, '') || 'docs'
  const title = opts.title ?? basename(root)

  if (existing.found) {
    kept.push(CONFIG_FILE)
  } else {
    const config = { docsDir, title }
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n')
    created.push(CONFIG_FILE)
  }

  const base = join(root, docsDir)
  const hasMarkdown =
    existsSync(base) && readdirSync(base, { recursive: true }).some((f) => /\.md$/i.test(String(f)))

  if (hasMarkdown) {
    kept.push(`${docsDir}/`)
  } else {
    mkdirSync(base, { recursive: true })
    writeFileSync(
      join(base, 'index.md'),
      `# ${title}\n\nWelcome. This page is the landing page of your DocuGate space.\n\n` +
        `Every \`.md\` file in \`${docsDir}/\` becomes a page, and every folder becomes a\n` +
        `section in the sidebar. The first \`# heading\` in a file is its title.\n`,
    )
    created.push(`${docsDir}/index.md`)
  }

  return { created, kept, docsDir }
}

// ---------------------------------------------------------------------------
// Interactive setup flow
// ---------------------------------------------------------------------------

export type Role = 'frontend' | 'backend' | 'both'

/** Minimal I/O surface so the flow can be driven by tests without a terminal. */
export interface IO {
  isTTY: boolean
  ask(question: string, defaultAnswer: string): Promise<string>
  print(line: string): void
}

/** Injectable for tests: replaces the real getSpaces call. */
export type GetSpacesFn = () => Promise<{ spaces: Space[] }>

/** Injectable for tests: replaces the real connectRepo call. */
export type ConnectRepoFn = (spaceId: string, repo: string, docsDir: string) => Promise<void>

/** Injectable for tests: replaces the real getSession call. */
export type GetSessionFn = () => Promise<{ user: { githubLogin: string } | null }>

/** Injectable for tests: replaces the real login call. */
export type LoginFn = (baseUrl: string, opts?: LoginOptions) => Promise<{ token: string }>

/** Injectable for tests: replaces `git remote get-url origin`. Returns null if no remote. */
export type GetRemoteFn = (root: string) => string | null

export interface InitFlowOptions {
  dir?: string
  title?: string
  role?: Role
  yes?: boolean
  port?: number
  io?: IO
  runBob?: RunBob
  getSessionFn?: GetSessionFn
  getSpacesFn?: GetSpacesFn
  connectFn?: ConnectRepoFn
  loginFn?: LoginFn
  getRemoteFn?: GetRemoteFn
  /** Base URL for DocuGate (overrides DOCUGATE_URL env var). */
  baseUrl?: string
  createSpaceFn?: (repo: string, name: string, docsDir: string) => Promise<{ name: string; owner: string; slug: string }>
  /** Puts the project on GitHub when it has no remote; injectable for tests. */
  createRepoFn?: (root: string, io: IO) => Promise<string | null>
  /** Opens a URL in the browser; injectable for tests. */
  openUrl?: (url: string) => void
}

export interface InitFlowResult {
  created: string[]
  kept: string[]
  docsDir: string
  role: Role | undefined
  tourResult?: TourInitResult
  tourError?: string
  installResult?: TourInstallResult
  connectError?: string
  /** Set when a folder above already has the project's setup; nothing was written here. */
  alreadySetUp?: string
}

export function makeDefaultIO(): IO {
  const isTTY = Boolean(process.stdin.isTTY)
  return {
    isTTY,
    ask(question, defaultAnswer) {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        rl.question(`${question} `, (answer) => {
          rl.close()
          resolve(answer.trim() || defaultAnswer)
        })
      })
    },
    print(line) {
      console.log(line)
    },
  }
}

/**
 * The nearest folder above `root`, inside the same Git repository, that has
 * DocuGate set up already (a docugate.json), if any.
 */
export function setUpAbove(root: string): string | undefined {
  if (existsSync(join(root, '.git'))) return undefined
  let dir = dirname(root)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir
    if (existsSync(join(dir, '.git'))) return undefined
    dir = dirname(dir)
  }
  return undefined
}

/** Sets one key in docugate.json, keeping everything else as it was. */
function saveSetting(root: string, key: string, value: unknown): void {
  const path = join(root, CONFIG_FILE)
  let existing: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      // unreadable: start again with this key
    }
  }
  existing[key] = value
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n')
}

const BOB_KEYS_URL = 'https://bob.ibm.com/docs/ide/account/api-keys'

/**
 * Bob Shell runs on its own with an API key, not the IDE sign-in. Setup gets
 * one without anyone editing environment variables: open the page that makes
 * it, paste it, and it is kept in ~/.docugate/bob.json, outside the repository.
 */
async function askForBobKey(io: IO, openUrl?: (url: string) => void): Promise<boolean> {
  const pick = await choose(io, 'IBM Bob needs an API key to write the tour. Get one now?', [
    'Yes, open the page to create an Inference key, then paste it here',
    'Skip the tour for now',
  ])
  if (pick !== 1) return false
  io.print(`  In your Bob instance: API keys, then create an Inference key.`)
  io.print(`  ${BOB_KEYS_URL}`)
  ;(openUrl ?? openInBrowser)(BOB_KEYS_URL)
  const key = (await io.ask('  Paste the key and press Enter (it stays on this computer)', '')).trim()
  if (!key) {
    io.print('  No key pasted. Skipped the tour: run docugate tour init when you have one.')
    return false
  }
  saveBobKey(key)
  io.print('  Key saved in ~/.docugate/bob.json. It is never written into the repository.')
  return true
}

function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // the URL is printed above
  }
}

export const FRESHNESS = [
  { value: 'push', label: 'On every push' },
  { value: 'daily', label: 'Once a day (recommended: fewer AI runs)' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'off', label: 'Never, I will ask for it' },
] as const

function saveRole(root: string, role: Role): void {
  const path = join(root, CONFIG_FILE)
  let existing: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      // leave as empty object; will be overwritten with role added
    }
  }
  existing.role = role
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n')
}

const ROLE_CHOICES: Array<{ role: Role }> = [{ role: 'frontend' }, { role: 'backend' }, { role: 'both' }]

const FRONTEND_DIRS = ['frontend', 'client', 'web']
const BACKEND_DIRS = ['backend', 'server', 'api']
const FRONTEND_MARKERS = ['index.html', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'angular.json', 'svelte.config.js']
const BACKEND_MARKERS = ['go.mod', 'requirements.txt', 'pyproject.toml', 'manage.py', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json']

/**
 * What the repository probably is, from its folders and files, so the question
 * can suggest an answer. Only a suggestion: the person always confirms it.
 */
export function guessRole(root: string): Role | undefined {
  const has = (name: string) => existsSync(join(root, name))
  const front = FRONTEND_DIRS.some(has)
  const back = BACKEND_DIRS.some(has)
  if (front && back) return 'both'
  if (FRONTEND_MARKERS.some(has) || front) return 'frontend'
  if (BACKEND_MARKERS.some(has) || back) return 'backend'
  return undefined
}

/**
 * A numbered choice: prints the options, and takes only a number. Enter picks
 * the default. Nobody types a word during setup.
 */
export async function choose(io: IO, question: string, options: string[], fallback = 1): Promise<number> {
  io.print('')
  io.print(`  ${question}`)
  options.forEach((option, i) => io.print(`    ${i + 1}  ${option}`))
  for (;;) {
    const answer = (await io.ask(`  Choose 1-${options.length} [${fallback}]`, String(fallback))).trim()
    const n = Number(answer)
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n
    io.print(`  Type a number from 1 to ${options.length}.`)
  }
}

function run(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    return { ok: true, out: out.trim() }
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    return { ok: false, out: (e.stderr ?? e.message).trim() }
  }
}

/**
 * A space reads from a GitHub repository. When the project has none yet, offer
 * to create one with the GitHub CLI, which is already signed in as the person,
 * and push the code to it. Returns owner/name, or null when skipped or failed.
 * DocuGate's own GitHub sign-in is not given the right to create repositories.
 */
async function createGitHubRepo(root: string, io: IO): Promise<string | null> {
  const pick = await choose(io, 'This project is not on GitHub yet, and a space reads from a GitHub repository.', [
    'Create a GitHub repository for it now (uses the GitHub CLI)',
    'Skip for now',
  ])
  if (pick !== 1) return null

  if (!run('gh', ['auth', 'status'], root).ok) {
    io.print('  The GitHub CLI is not installed or not signed in.')
    io.print('  Install it from https://cli.github.com, run gh auth login, then docugate init again.')
    return null
  }
  if (!run('git', ['rev-parse', 'HEAD'], root).ok) {
    io.print('  Commit your code first (git add -A, then git commit), then run docugate init again.')
    return null
  }
  const visibility = await choose(io, 'Who can see the repository?', [
    'Public',
    'Private (a space from a private repository needs DocuGate Pro)',
  ])
  const name = basename(root).replace(/[^A-Za-z0-9._-]+/g, '-')
  const made = run('gh', ['repo', 'create', name, visibility === 1 ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push'], root)
  if (!made.ok) {
    io.print(`  Could not create the repository: ${made.out.split(/\r?\n/).pop()}`)
    return null
  }
  const slug = defaultGetRemote(root)
  if (slug) io.print(`  Created https://github.com/${slug} and pushed your code.`)
  return slug
}

function defaultGetRemote(root: string): string | null {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    // Match HTTPS: https://github.com/owner/repo(.git)
    // Match SSH:   git@github.com:owner/repo(.git)
    const m = remote.match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * Runs the full interactive DocuGate setup wizard. Asks one short question,
 * saves the result in docugate.json, conditionally runs tour init and tour
 * install, and prints a summary.
 */
export async function initFlow(root: string, options: InitFlowOptions = {}): Promise<InitFlowResult> {
  const io = options.io ?? makeDefaultIO()
  const yes = options.yes ?? false
  const port = options.port ?? DEFAULT_PORT

  // One project gets one setup and one tour. Run inside frontend/ of a
  // project already set up at its root, and init points there instead of
  // starting a second one.
  const parent = setUpAbove(root)
  if (parent) {
    io.print(`  This project is already set up in ${parent}.`)
    io.print(`  One project has one tour: run docugate commands from that folder.`)
    const above = loadConfig(parent)
    return { created: [], kept: [], docsDir: above.docsDir, role: above.config.role, alreadySetUp: parent }
  }

  // ── Step 1: base repo setup (docugate.json + docs/) ──────────────────────
  const base = init(root, { dir: options.dir, title: options.title })

  // ── Step 2: determine role ────────────────────────────────────────────────
  const loaded = loadConfig(root)
  const savedRole = loaded.config.role

  let role: Role | undefined = savedRole ?? options.role

  if (!role) {
    if (!io.isTTY) {
      // CI / no terminal: write config without role and explain.
      io.print(`  docugate.json written. Set the repository role with --role frontend|backend|both.`)
      io.print(`  Run docugate login to connect this repository to a DocuGate space.`)
      // Return early — no tour steps without a known role.
      return { ...base, role: undefined }
    }

    if (yes) {
      // --yes with no --role: default to "both"
      role = 'both'
    } else {
      // Interactive: a numbered choice with examples, the likely answer
      // suggested from the folders in the repository.
      const guess = guessRole(root)
      const guessNumber = String(ROLE_CHOICES.findIndex((c) => c.role === guess) + 1)
      const n = await choose(
        io,
        `What is in this repository?${guess ? ` (it looks like ${guess})` : ''}`,
        [
          'Frontend   the app people see: React, Vue, Svelte, Next.js, plain HTML',
          'Backend    the API or server: Node, Python, Go, Java, ...',
          'Both       frontend and backend in one repository, for example:\n' +
            '                 my-app/\n' +
            '                 ├─ frontend/   (or client/, web/)\n' +
            '                 └─ backend/    (or server/, api/)',
        ],
        guessNumber === '0' ? 3 : Number(guessNumber),
      )
      role = ROLE_CHOICES[n - 1].role
    }
  }

  if (!savedRole) {
    saveRole(root, role)
  }

  // ── Step 3: sign in and connect this repository ───────────────────────────
  const BASE_URL = options.baseUrl ?? process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'

  let connectError: string | undefined

  // In CI (no TTY) skip sign-in entirely (hint already printed in the early-return branch above).
  if (!io.isTTY) {
    // nothing more — hint was already printed
  } else {
    // Lazily import real API functions only when not overridden by tests.
    const realGetSession: GetSessionFn = async () => {
      const { getSession } = await import('./api.js')
      return getSession()
    }
    const realGetSpaces: GetSpacesFn = async () => {
      const { getSpaces } = await import('./api.js')
      return getSpaces()
    }
    const realConnectRepo: ConnectRepoFn = async (id, repo, dir) => {
      const { connectRepo } = await import('./api.js')
      return connectRepo(id, repo, dir)
    }
    const realLogin: LoginFn = login

    const getSessionFn = options.getSessionFn ?? realGetSession
    const getSpacesFn = options.getSpacesFn ?? realGetSpaces
    const connectFn = options.connectFn ?? realConnectRepo
    const loginFn = options.loginFn ?? realLogin
    const getRemoteFn = options.getRemoteFn ?? defaultGetRemote

    // ── 3a: ensure the user is signed in ─────────────────────────────────────
    let signedIn = false
    try {
      // When getSessionFn is injected (tests), trust it directly.
      // In production, only call it if there are saved credentials.
      const creds = options.getSessionFn ? true : loadCredentials()
      if (creds) {
        const sess = await getSessionFn()
        signedIn = sess.user !== null
      }
    } catch {
      // can't reach server; treat as not signed in
    }

    if (!signedIn) {
      let doLogin = yes
      if (!yes) {
        doLogin =
          (await choose(io, 'Sign in to DocuGate, so this repository can feed a space?', [
            'Yes, open the browser to sign in',
            'Skip for now (docugate login does it later)',
          ])) === 1
      }
      if (doLogin) {
        try {
          await loginFn(BASE_URL)
          signedIn = true
          io.print(`  Signed in to DocuGate.`)
        } catch (err) {
          connectError = `Sign-in failed: ${(err as Error).message}`
          io.print(`  warning  ${connectError}`)
        }
      }
    }

    // ── 3b: connect this repository to a space ────────────────────────────────
    if (signedIn) {
      // Read git remote; a project not on GitHub yet can be put there first.
      let repoSlug = getRemoteFn(root)
      if (!repoSlug && !yes) {
        repoSlug = await (options.createRepoFn ?? createGitHubRepo)(root, io)
      }

      if (!repoSlug) {
        io.print(`  A space reads from a GitHub repository, so this one can't be connected yet.`)
      } else {
        // List spaces.
        let spaces: Space[] = []
        try {
          const res = await getSpacesFn()
          spaces = res.spaces
        } catch (err) {
          connectError = `Couldn't load spaces: ${(err as Error).message}`
          io.print(`  warning  ${connectError}`)
        }

        const { docsDir: repoDocsDir } = loadConfig(root)
        const hasRepo = (sp: Space) => (sp.sources ?? []).some((src) => src.repo.toLowerCase() === repoSlug.toLowerCase())
        const already = spaces.find(hasRepo)

        if (connectError) {
          // the warning is printed already; carry on with the rest of setup
        } else if (yes) {
          // --yes: connect only when there is no doubt which space is meant.
          if (already) {
            io.print(`  ${repoSlug} is already in space "${already.name}".`)
          } else if (spaces.length === 1) {
            try {
              await connectFn(spaces[0].id, repoSlug, repoDocsDir)
              io.print(`  Connected ${repoSlug} to space "${spaces[0].name}".`)
            } catch (err) {
              connectError = (err as Error).message
              io.print(`  warning  ${connectError}`)
            }
          } else if (spaces.length > 1) {
            io.print(`  Several spaces found: run docugate init again without --yes to choose.`)
          }
        } else {
          // Interactive: create a space, or pick one, or skip. Numbers only.
          const choices = [
            `Create a new space for ${repoSlug}`,
            ...spaces.map((sp) => `${sp.name}  (${sp.owner}/${sp.slug})${hasRepo(sp) ? '  already reads this repository' : ''}`),
            'Skip for now',
          ]
          const pick = await choose(
            io,
            `Which DocuGate space should document ${repoSlug}?`,
            choices,
            already ? spaces.indexOf(already) + 2 : 1,
          )
          if (pick === 1) {
            try {
              const createFn = options.createSpaceFn ?? (async (repo: string, name: string, dir: string) => {
                const { createSpace } = await import('./api.js')
                return createSpace(repo, name, dir)
              })
              const created = await createFn(repoSlug, loadConfig(root).config.title ?? repoSlug.split('/')[1], repoDocsDir)
              io.print(`  Created space "${created.name}": ${BASE_URL}/${created.owner}/${created.slug}`)
            } catch (err) {
              connectError = (err as Error).message
              io.print(`  warning  ${connectError}`)
            }
          } else if (pick <= spaces.length + 1) {
            const sp = spaces[pick - 2]
            if (hasRepo(sp)) {
              io.print(`  ${repoSlug} is already in space "${sp.name}". Nothing to change.`)
            } else {
              try {
                await connectFn(sp.id, repoSlug, repoDocsDir)
                io.print(`  Connected ${repoSlug} to space "${sp.name}".`)
              } catch (err) {
                connectError = (err as Error).message
                io.print(`  warning  ${connectError}`)
              }
            }
          } else {
            io.print(`  Skipped. docugate init connects it any time.`)
          }
        }
      }
    }
  }

  // ── Step 3c: how often the docs are checked against the code ─────────────
  if (io.isTTY && !loaded.config.freshness) {
    const n = yes
      ? 2
      : await choose(io, 'How often should DocuGate check that your docs still match the code?', FRESHNESS.map((f) => f.label), 2)
    saveSetting(root, 'freshness', FRESHNESS[n - 1].value)
    io.print(`  Saved: ${FRESHNESS[n - 1].label.split(' (')[0].toLowerCase()}. Change "freshness" in docugate.json any time.`)
  }

  // ── Step 4: tour steps (frontend / both only) ─────────────────────────────
  let tourResult: TourInitResult | undefined
  let tourError: string | undefined
  let installResult: TourInstallResult | undefined

  if (role === 'frontend' || role === 'both') {
    // Decide whether to run tour init.
    let runTour = yes
    if (!yes && io.isTTY) {
      const pick = await choose(io, 'Set up the tour: which AI should read your code and write it?', [
        'IBM Bob (uses Bobcoins)',
        'IBM watsonx (coming soon)',
        'Skip, I will write it in the browser',
      ], 3)
      if (pick === 2) io.print('  IBM watsonx is coming soon. Skipped for now: run docugate tour init when you are ready.')
      runTour = pick === 1
      if (runTour && !readBobKey() && !options.runBob) runTour = await askForBobKey(io, options.openUrl)
    }

    if (runTour) {
      try {
        tourResult = tourInit(root, { runBob: options.runBob })
      } catch (error) {
        // Bob missing or failed — describe what went wrong, then continue.
        if (error instanceof BobKeyMissingError) {
          tourError =
            `Bob Shell needs an API key. Set BOB_API_KEY, then run docugate tour init.`
        } else if (error instanceof BobMissingError) {
          tourError =
            `Bob Shell is not installed. Install it, sign in, then run docugate tour init.`
        } else {
          tourError = `Tour init failed: ${(error as Error).message}. Run docugate tour init to retry.`
        }
        io.print(`  warning  ${tourError}`)
      }
    }

    // tour install: ask in TTY unless --yes.
    let runInstall = yes
    if (!yes && io.isTTY) {
      runInstall =
        (await choose(io, 'Add the DocuGate pill to your app? (development only)', [
          'Yes, add it',
          'Skip, I will run docugate tour install later',
        ])) === 1
    }

    if (runInstall) {
      installResult = tourInstall(root, { port })
      if (installResult.target === null) {
        io.print(`  Paste this into your app's HTML during development:`)
        io.print(`    ${pillSnippetLine(port)}`)
      }
    }
  } else {
    // backend
    io.print(
      `  backend role: skipping tour. The frontend repository's tour can point into this one.`,
    )
  }

  // ── Step 5: summary ───────────────────────────────────────────────────────
  io.print(``)
  for (const f of base.created) io.print(`  created  ${f}`)
  for (const f of base.kept) io.print(`  kept     ${f}`)
  if (!savedRole && role) io.print(`  saved    role: ${role} in ${CONFIG_FILE}`)
  if (tourResult) {
    for (const f of tourResult.setup) io.print(`  created  ${f}`)
    for (const f of tourResult.added) io.print(`  added    ${f}`)
    for (const f of tourResult.restored) io.print(`  kept     ${f} (Bob changed it; your version was put back)`)
  }
  if (installResult?.action === 'inserted') io.print(`  installed pill in ${installResult.target}`)
  if (installResult?.action === 'already') io.print(`  pill already in ${installResult.target}`)

  io.print(``)
  io.print(`Next: docugate tour serve`)

  return { ...base, role, tourResult, tourError, installResult, connectError }
}
