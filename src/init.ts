import { createInterface } from 'node:readline'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { CONFIG_FILE, loadConfig } from './config.js'
import type { RunBob } from './tour-init.js'
import { tourInit, BobMissingError, BobKeyMissingError, readBobKey, useBobKeyForThisRun } from './tour-init.js'
import type { CreatedRepo } from './api.js'
import { bobKeyCandidates, startSpinner } from './spinner.js'
import { logoBanner } from './logo.js'
import { tourInstall, pillSnippetLine, DEFAULT_PORT } from './tour-install.js'
import type { TourInitResult } from './tour-init.js'
import type { TourInstallResult } from './tour-install.js'
import { login, loadCredentials } from './auth.js'
import type { LoginOptions } from './auth.js'
import type { Space } from './api.js'

export type InitResult = { created: string[]; kept: string[]; docsDir: string }

/**
 * How to write a docugate command for the person reading it: installed in the
 * project (npm i docugate) it runs through npx; installed on the computer it
 * is plain `docugate`. Judged from where this copy of the CLI lives.
 */
export function asCommand(line: string, script = process.argv[1] ?? ''): string {
  if (!/[\\/]node_modules[\\/]/.test(script) || /[\\/]npm[\\/]node_modules[\\/]|[\\/]lib[\\/]node_modules[\\/]/.test(script)) return line
  return line.replace(/(^|[\s(`"'])docugate (init|login|logout|whoami|check|openapi|tour)\b/g, '$1npx docugate $2')
}

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
  /** Like ask, without echoing what is typed: for keys. */
  askSecret?(question: string, defaultAnswer: string): Promise<string>
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
  /** Creates the documentation repository for a new space; injectable for tests. */
  createDocsRepoFn?: (name: string, isPrivate: boolean, title: string) => Promise<CreatedRepo>
  /** Creates the docs repository with the GitHub CLI when DocuGate cannot; injectable for tests. */
  ghDocsRepoFn?: (name: string, isPrivate: boolean, title: string, io: IO) => CreatedRepo | null
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
    askSecret(question, defaultAnswer) {
      // Keys must never be shown on screen, where screenshots and recordings
      // pick them up: print the question, then echo nothing while typing.
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
        const muted = rl as unknown as { _writeToOutput: (s: string) => void }
        process.stdout.write(`${question} `)
        muted._writeToOutput = () => undefined
        rl.question('', (answer) => {
          rl.close()
          process.stdout.write('[hidden]\n')
          resolve(answer.trim() || defaultAnswer)
        })
      })
    },
    print(line) {
      console.log(asCommand(line))
    },
  }
}

function gh(args: string[], cwd = process.cwd()): { ok: boolean; out: string } {
  try {
    const out = execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: out.trim() }
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    return { ok: false, out: (e.stderr ?? e.message).trim() }
  }
}

/**
 * The docs repository through the GitHub CLI, signed in as the person: create
 * it with a README, then write docs/index.md into it through the GitHub API.
 * Null when gh is not installed or not signed in, with the reason printed.
 */
function createDocsRepoWithGh(name: string, isPrivate: boolean, title: string, io: IO): CreatedRepo | null {
  const who = gh(['api', 'user', '--jq', '.login'])
  if (!who.ok || !who.out) {
    io.print(`  To create it another way, install the GitHub CLI (https://cli.github.com), run gh auth login, then docugate init again.`)
    io.print(`  Or create ${name} on github.com and pick "connect" in docugate init.`)
    return null
  }
  const stop = startSpinner(['Creating the docs repository with the GitHub CLI', 'Writing its first page'])
  const made = gh(['repo', 'create', name, isPrivate ? '--private' : '--public', '--add-readme',
    '--description', `Documentation for ${title}, published with DocuGate`])
  if (!made.ok && !/already exists/i.test(made.out)) {
    stop()
    io.print(`  warning  The GitHub CLI could not create ${name}: ${made.out.split(/\r?\n/).pop()}`)
    return null
  }
  const full = `${who.out}/${name}`
  const page = `# ${title}\n\nWelcome. This is the start of the documentation for ${title}.\n\nEvery markdown file in this \`docs/\` folder becomes a page on DocuGate.\n`
  const seeded = gh(['api', '-X', 'PUT', `repos/${full}/contents/docs/index.md`,
    '-f', 'message=docs: first page, created by DocuGate',
    '-f', `content=${Buffer.from(page).toString('base64')}`]).ok
  stop()
  io.print(`  ${green('✓')} Created https://github.com/${full} with the GitHub CLI`)
  return { repo: full, url: `https://github.com/${full}`, cloneUrl: `https://github.com/${full}.git`, seeded }
}

/**
 * A new space and the repository that holds its docs: the repository is
 * created on the person's account with docs/index.md in it, then the space is
 * made from it. Returns the space, or undefined when something stopped it
 * (every reason is printed).
 */
async function createDocsSpace(
  io: IO,
  projectName: string,
  baseUrl: string,
  options: InitFlowOptions,
): Promise<{ owner: string; slug: string; name: string } | undefined> {
  const visibility = await choose(io, 'Who can read the docs repository on GitHub?', [
    'Public',
    'Private (a space from a private repository needs DocuGate Pro)',
  ])
  const repoName = `${projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')}-docs`

  const stop = startSpinner(['Creating the docs repository on GitHub', 'Writing its first page', 'Almost there'])
  let repo: CreatedRepo | undefined
  try {
    repo = await (options.createDocsRepoFn ?? (async (name: string, priv: boolean, title: string) => {
      const { createRepo } = await import('./api.js')
      return createRepo(name, priv, { title })
    }))(repoName, visibility === 2, projectName)
    stop()
    io.print(`  ${green('✓')} Created ${repo.url}`)
  } catch (err) {
    stop()
    const { code } = err as { code?: string }
    // DocuGate could not create it (the app's permission, or GitHub's rules
    // for app tokens). The person's own GitHub CLI can: try that before
    // giving up, so the setup still ends with a space.
    if (code === 'app_permission' || code === 'github_error') {
      io.print(`  ${dimmed((err as Error).message)}`)
      repo = (options.ghDocsRepoFn ?? createDocsRepoWithGh)(repoName, visibility === 2, projectName, io) ?? undefined
    } else if (code === 'repo_exists') {
      // A second run, or a repository made by hand: use it rather than stop.
      const login = await (options.getSessionFn ?? (async () => (await import('./api.js')).getSession()))()
        .then((s) => s.user?.githubLogin)
        .catch(() => undefined)
      if (login) {
        repo = { repo: `${login}/${repoName}`, url: `https://github.com/${login}/${repoName}`, cloneUrl: '' }
        io.print(`  ${repo.repo} already exists: using it for the docs.`)
      } else {
        io.print(`  warning  ${(err as Error).message}`)
      }
    } else {
      io.print(`  warning  ${(err as Error).message}`)
    }
    if (!repo) return undefined
  }

  const createFn = options.createSpaceFn ?? (async (r: string, name: string, dir: string) => {
    const { createSpace } = await import('./api.js')
    return createSpace(r, name, dir)
  })
  // A space only ever reads a repository DocuGate can see. One installed on
  // selected repositories may not include the new one yet: offer the install
  // and try again once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const stopSpace = startSpinner(['Setting up your space', 'Reading the docs repository'])
    try {
      const space = await createFn(repo.repo, projectName, 'docs')
      stopSpace()
      io.print(`  Created space "${space.name}"`)
      if (repo.seeded === false) io.print(`  Add markdown files to docs/ in ${repo.repo} and they become pages.`)
      return space
    } catch (err) {
      stopSpace()
      io.print(`  warning  ${(err as Error).message}`)
      if ((err as { code?: string }).code !== 'no_repo_access' || attempt > 0) return undefined
      const fix = await choose(io, `The DocuGate GitHub App can't see ${repo.repo} yet.`, [
        'Add it to the app (opens GitHub), then try again',
        'Skip for now',
      ])
      if (fix !== 1) return undefined
      ;(options.openUrl ?? openInBrowser)(`${baseUrl}/api/auth/github?install=1`)
      await io.ask(`  On GitHub, add ${repo.repo} (or choose All repositories) and save. Then press Enter here:`, '')
    }
  }
  return undefined
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
 * Bob Shell runs on its own with an API key, not the IDE sign-in, and reads it
 * from BOB_API_KEY. When that is not set, setup can take a pasted key for this
 * one run only: DocuGate never stores it, and says how to set it for good.
 */
async function askForBobKey(io: IO, openUrl?: (url: string) => void): Promise<boolean> {
  const pick = await choose(io, 'IBM Bob needs an API key (BOB_API_KEY is not set in your environment).', [
    'Paste a key for this run only (opens the page that creates one)',
    'Skip the tour for now',
  ])
  if (pick !== 1) return false
  io.print(`  In your Bob instance: API keys, then create an Inference key.`)
  io.print(`  ${BOB_KEYS_URL}`)
  ;(openUrl ?? openInBrowser)(BOB_KEYS_URL)
  const key = (await (io.askSecret ?? io.ask)('  Paste the key and press Enter (hidden, used for this run only, never saved):', '')).trim()
  if (!key) {
    io.print('  No key pasted. Skipped the tour: run docugate tour init when you have one.')
    return false
  }
  useBobKeyForThisRun(key)
  // Say it arrived, without showing it: the last four characters and the length.
  io.print(`  ${green('✓')} Key received (…${key.slice(-4)}, ${key.length} characters). Using it for this run only.`)
  io.print('  To keep it for next time, set it in your environment:')
  io.print(process.platform === 'win32'
    ? '    [Environment]::SetEnvironmentVariable("BOB_API_KEY", "<key>", "User")   (then open a new terminal)'
    : '    export BOB_API_KEY=<key>   (add it to your shell profile)')
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

// ── Look ───────────────────────────────────────────────────────────────────
// Color only in a real terminal, and never when NO_COLOR is set, so logs and
// CI stay plain text.
const colorOn = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (code: string) => (text: string) => (colorOn() ? `\x1b[${code}m${text}\x1b[0m` : text)
const bold = paint('1')
const dimmed = paint('2')
const gold = paint('38;2;244;196;63')
const cream = paint('38;2;245;240;227')
const green = paint('32')

/** DocuGate's owl, drawn small: cream eyes, gold beak. */
export function banner(): string[] {
  const text = [bold(cream('DocuGate')), dimmed('Tours and docs for your codebase')]
  // Without color there is no picture to draw: just the name.
  if (!colorOn()) return ['', `  DocuGate · Tours and docs for your codebase`, '']
  return logoBanner(text)
}

/**
 * A numbered choice: prints the options, and takes only a number. Enter picks
 * the default. Nobody types a word during setup.
 */
export async function choose(io: IO, question: string, options: string[], fallback = 1): Promise<number> {
  io.print('')
  io.print(`  ${bold(question)}`)
  options.forEach((option, i) => io.print(`    ${gold(String(i + 1))}  ${option}`))
  for (;;) {
    const answer = (await io.ask(`  ${dimmed(`Choose 1-${options.length} [${fallback}]`)}:`, String(fallback))).trim()
    const n = Number(answer)
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n
    io.print(`  Type a number from 1 to ${options.length}.`)
  }
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
  if (io.isTTY) for (const line of banner()) io.print(line)

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

    // ── 3b: the space that holds this project's documentation ─────────────────
    // A space reads markdown from a GitHub repository. A new space gets its own
    // documentation repository, created on the person's account; an existing
    // space can be picked instead. Either way docugate.json remembers it, so the
    // pill can link to the published docs.
    if (signedIn) {
      const repoSlug = getRemoteFn(root)
      let spaces: Space[] = []
      try {
        spaces = (await getSpacesFn()).spaces
      } catch (err) {
        connectError = `Couldn't load spaces: ${(err as Error).message}`
        io.print(`  warning  ${connectError}`)
      }

      const { docsDir: repoDocsDir, config } = loadConfig(root)
      const projectName = config.title ?? repoSlug?.split('/')[1] ?? basename(root)
      const hasRepo = (sp: Space) =>
        Boolean(repoSlug) && (sp.sources ?? []).some((src) => src.repo.toLowerCase() === repoSlug!.toLowerCase())
      const already = spaces.find(hasRepo)
      const linkSpace = (sp: { owner: string; slug: string; name: string }) => {
        saveSetting(root, 'space', `${sp.owner}/${sp.slug}`)
        io.print(`  Docs will be published at ${BASE_URL}/${sp.owner}/${sp.slug}`)
      }
      const connectProject = async (sp: Space) => {
        if (!repoSlug || hasRepo(sp)) return
        try {
          await connectFn(sp.id, repoSlug, repoDocsDir)
          io.print(`  Connected ${repoSlug} to space "${sp.name}".`)
        } catch (err) {
          connectError = (err as Error).message
          io.print(`  warning  ${connectError}`)
        }
      }

      if (connectError) {
        // the warning is printed already; carry on with the rest of setup
      } else if (yes) {
        // --yes: use the space only when there is no doubt which one is meant.
        const only = already ?? (spaces.length === 1 ? spaces[0] : undefined)
        if (only) {
          await connectProject(only)
          linkSpace(only)
        } else if (spaces.length > 1) {
          io.print(`  Several spaces found: run docugate init again without --yes to choose.`)
        }
      } else {
        const choices = [
          'Create a new space, with a new repository for its docs',
          ...spaces.map((sp) => `${sp.name}  (${sp.owner}/${sp.slug})${hasRepo(sp) ? '  already has this project' : ''}`),
          'Skip for now',
        ]
        const pick = await choose(io, `Where should the documentation for ${projectName} live?`, choices, already ? spaces.indexOf(already) + 2 : 1)
        if (pick === 1) {
          const created = await createDocsSpace(io, projectName, BASE_URL, options)
          if (created) linkSpace(created)
          else connectError = 'The space was not created.'
        } else if (pick <= spaces.length + 1) {
          const sp = spaces[pick - 2]
          await connectProject(sp)
          linkSpace(sp)
        } else {
          io.print(`  Skipped. docugate init sets it up any time.`)
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
      ])
      if (pick === 2) io.print('  IBM watsonx is coming soon. Skipped for now: run docugate tour init when you are ready.')
      runTour = pick === 1
      if (runTour && !readBobKey() && !options.runBob) {
        // The key may be in the environment under another name.
        const [other] = bobKeyCandidates()
        if (other) {
          const use = await choose(io, `BOB_API_KEY is not set, but ${other} is. Is that your IBM Bob key?`, [
            `Yes, use ${other} for this run`,
            'No',
          ])
          if (use === 1) {
            useBobKeyForThisRun(process.env[other]!)
            io.print(`  Tip: rename it to BOB_API_KEY in your environment so Bob finds it next time.`)
          }
        }
        if (!readBobKey()) runTour = await askForBobKey(io, options.openUrl)
      }
    }

    if (runTour) {
      // Bob takes a minute or two. Show it working, the way an assistant does.
      const stop = options.runBob
        ? () => undefined
        : startSpinner([
            'IBM Bob is reading your screens and routes',
            'Following each value to the endpoint it comes from',
            'Tracing it into the backend',
            'Writing the tour, one step per element',
            'Checking every file it names exists',
            'Still working: bigger apps take a little longer',
          ])
      try {
        tourResult = tourInit(root, { runBob: options.runBob })
        stop()
        io.print(`  ${green('✓')} IBM Bob wrote the tour (${tourResult.added.length} screen${tourResult.added.length === 1 ? '' : 's'}).`)
      } catch (error) {
        stop()
        // Bob missing or failed — describe what went wrong, then continue.
        if (error instanceof BobKeyMissingError) {
          tourError =
            `✗ IBM Bob did not accept this key. Check it is an Inference key from bob.ibm.com, then run docugate tour init.`
        } else if (error instanceof BobMissingError) {
          tourError =
            `Bob Shell is not installed. Install it, sign in, then run docugate tour init.`
        } else {
          // One calm line; the technical detail only when asked for.
          tourError = `IBM Bob couldn't write the tour this time. The pill still works: add steps in the browser, or run docugate tour init later.`
          if (process.env.DOCUGATE_DEBUG) io.print(`  detail  ${(error as Error).message}`)
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

  const hasPill = installResult?.action === 'inserted' || installResult?.action === 'already'
  const final = loadConfig(root).config
  const freshness = FRESHNESS.find((f) => f.value === final.freshness)
  const rows: Array<[string, string]> = [
    ['Repository', role ? role.charAt(0).toUpperCase() + role.slice(1) : 'not set'],
    ['Docs', final.space ?? 'no space yet'],
    ['Checks', freshness ? freshness.label.split(' (')[0] : 'not set'],
  ]
  if (role !== 'backend') {
    rows.push(['Tour', tourResult ? `IBM Bob wrote ${tourResult.added.length} screen${tourResult.added.length === 1 ? '' : 's'}` : 'add steps in the browser'])
    rows.push(['Tour button', hasPill && installResult?.target ? installResult.target : 'not added'])
    if (installResult?.hook) rows.push(['Starts with', `npm run ${installResult.hook.replace(/^pre/, '')}`])
  }
  io.print(``)
  io.print(`  ${dimmed('╭')} ${bold('DocuGate setup')}`)
  rows.forEach(([label, value], i) => {
    const branch = i === rows.length - 1 ? '╰' : '├'
    io.print(`  ${dimmed(branch)} ${label.padEnd(12)} ${green(value)}`)
  })
  io.print(``)
  if (role === 'backend') {
    io.print(`  ${green('✓')} ${bold('DocuGate is set up for this backend.')}`)
  } else if (hasPill) {
    io.print(`  ${green('✓')} ${bold('DocuGate is set up.')}`)
    const run = installResult?.hook ? `npm run ${installResult.hook.replace(/^pre/, '')}` : 'npm run dev'
    io.print(`    Start your project as usual (${gold(run)}) and open it:`)
    io.print(`    the ${gold('Tour')} button is in the bottom-right corner.`)
  } else {
    io.print(`  ${green('✓')} ${bold('DocuGate is set up.')} Run docugate tour install to add the Tour button to your app.`)
  }

  return { ...base, role, tourResult, tourError, installResult, connectError }
}
