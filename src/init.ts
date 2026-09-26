import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CONFIG_FILE, loadConfig } from './config.js'
import type { RunBob } from './tour-init.js'
import { tourInit, BobMissingError, BobKeyMissingError } from './tour-init.js'
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
}

function makeDefaultIO(): IO {
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

const VALID_ROLES = new Set<string>(['frontend', 'backend', 'both'])

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
      // Interactive: ask once; re-prompt on invalid answer.
      let answer = ''
      while (!VALID_ROLES.has(answer)) {
        answer = await io.ask(
          'Is this repository the frontend, the backend, or both? [frontend/backend/both]',
          'both',
        )
        if (!VALID_ROLES.has(answer)) {
          io.print(`  Please answer frontend, backend, or both.`)
        }
      }
      role = answer as Role
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
        const answer = await io.ask('Sign in to DocuGate now? [Y/n]', 'y')
        doLogin = !/^n(o)?$/i.test(answer)
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
      // Read git remote.
      const repoSlug = getRemoteFn(root)

      if (!repoSlug) {
        io.print(`  This repository has no GitHub remote yet, so it can't be connected to a space.`)
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

        if (spaces.length === 0 && !connectError) {
          io.print(`  No spaces found. Create one first: ${BASE_URL}/dashboard/new`)
        } else if (spaces.length > 0) {
          const { docsDir: repoDocsDir } = loadConfig(root)

          if (yes) {
            // --yes: auto-connect only when there is exactly one space.
            if (spaces.length === 1) {
              try {
                await connectFn(spaces[0].id, repoSlug, repoDocsDir)
                io.print(`  Connected ${repoSlug} to space "${spaces[0].name}".`)
              } catch (err) {
                connectError = (err as Error).message
                io.print(`  warning  ${connectError}`)
              }
            } else {
              io.print(`  Multiple spaces found — run docugate init again without --yes to choose:`)
              for (const s of spaces) io.print(`    ${s.owner}/${s.slug}  ${s.name}`)
            }
          } else {
            // Interactive: list spaces and ask.
            io.print(`  Your spaces:`)
            for (let i = 0; i < spaces.length; i++) {
              io.print(`    ${i + 1}. ${spaces[i].name}  (${spaces[i].owner}/${spaces[i].slug})`)
            }
            const answer = await io.ask(
              `Connect ${repoSlug} to which space? [1-${spaces.length}/skip]`,
              'skip',
            )
            const idx = parseInt(answer, 10) - 1
            if (!isNaN(idx) && idx >= 0 && idx < spaces.length) {
              try {
                await connectFn(spaces[idx].id, repoSlug, repoDocsDir)
                io.print(`  Connected ${repoSlug} to space "${spaces[idx].name}".`)
              } catch (err) {
                connectError = (err as Error).message
                io.print(`  warning  ${connectError}`)
              }
            } else {
              io.print(`  Skipped connecting to a space.`)
            }
          }
        }
      }
    }
  }

  // ── Step 4: tour steps (frontend / both only) ─────────────────────────────
  let tourResult: TourInitResult | undefined
  let tourError: string | undefined
  let installResult: TourInstallResult | undefined

  if (role === 'frontend' || role === 'both') {
    // Decide whether to run tour init.
    let runTour = yes
    if (!yes && io.isTTY) {
      const answer = await io.ask('Write the tour with IBM Bob? (costs Bobcoins) [y/N]', 'n')
      runTour = /^y(es)?$/i.test(answer)
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
      const answer = await io.ask('Add the pill loader to your app? [Y/n]', 'y')
      runInstall = !/^n(o)?$/i.test(answer)
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
