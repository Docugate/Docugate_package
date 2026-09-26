import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CONFIG_FILE, loadConfig } from './config.js'
import type { RunBob } from './tour-init.js'
import { tourInit, BobMissingError, BobKeyMissingError } from './tour-init.js'
import { tourInstall, pillSnippetLine, DEFAULT_PORT } from './tour-install.js'
import type { TourInitResult } from './tour-init.js'
import type { TourInstallResult } from './tour-install.js'

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

export interface InitFlowOptions {
  dir?: string
  title?: string
  role?: Role
  yes?: boolean
  port?: number
  io?: IO
  runBob?: RunBob
}

export interface InitFlowResult {
  created: string[]
  kept: string[]
  docsDir: string
  role: Role | undefined
  tourResult?: TourInitResult
  tourError?: string
  installResult?: TourInstallResult
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

  // ── Step 3: sign-in placeholder ───────────────────────────────────────────
  io.print(`  [coming soon] Sign in to DocuGate and connect this repository.`)

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

  return { ...base, role, tourResult, tourError, installResult }
}
