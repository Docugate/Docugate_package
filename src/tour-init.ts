import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'

// `docugate tour init` writes the first tour of an app by asking IBM Bob
// (through Bob Shell) to read the code. Bob does the reading; this file makes
// sure the result is safe to keep: Bob works in a mode that can only edit tour
// files, a tour file the user already has is never changed, and every run
// reports exactly what was added.

export const TOUR_DIR = '.docugate/tour'
export const MODE_SLUG = 'tour-writer'
const MODES_FILE = '.bob/custom_modes.yaml'
const RULES_FILE = `.bob/rules-${MODE_SLUG}/01-tour-format.md`

export const TOUR_RULES = `# DocuGate tour format

A tour explains the screens of an app to a developer who is new to its code.
It lives in \`${TOUR_DIR}/\`, one markdown file per screen.

## File

- Name the file after the screen's route: \`/invoices/:id\` becomes
  \`invoices-id.md\`, \`/\` becomes \`home.md\`.
- Front matter holds \`route\` (the URL pattern, with \`:param\` segments) and
  \`title\` (the screen's name).
- Then one \`##\` section per stop, in the order a person reads the screen.

## Stop

\`\`\`md
## Total
target: [data-tour="invoice-total"]
data: GET /api/invoices/:id → total
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://example.com/docs/billing

The amount due: the subtotal plus tax, computed by \`totals()\` in the backend.
\`\`\`

- \`target\`: a CSS selector for the element. Prefer \`[data-tour="..."]\`
  when the element has one. Otherwise use the most stable selector you can
  see, and add a line \`suggest: add data-tour="name" in <file>\`.
- \`data\`: the request the value comes from and the field in the response,
  as \`METHOD /path → field\`. Leave it out for elements that show no data.
- \`code\`: the file that renders the element, relative to the repository root.
- \`source\`: optional. The file where the value is computed or stored, when
  that is somewhere else, such as a backend service.
- \`docs\`: optional. A link that explains the concept.
- Then one or two sentences of plain prose: what the element is and why its
  value is what it is.

## Rules

- Only claim what the code shows. Every path must exist and every endpoint
  must appear in the code. If you are not sure where a value comes from,
  leave \`data\` and \`source\` out rather than guess.
- Pick the elements a new developer would ask about: numbers, statuses,
  actions and anything whose meaning is not obvious. Not every element.
- Never edit, rename or delete a tour file that already exists. Only add
  files for screens that have none.
- Change nothing outside \`${TOUR_DIR}/\`.
`

const MODE = {
  slug: MODE_SLUG,
  name: '🧭 Tour Writer',
  description: 'Writes DocuGate tour files that explain each screen of an app.',
  roleDefinition:
    'You read an application\'s frontend and backend code and write DocuGate tour files: for each screen, which elements matter, what they mean, and where their data really comes from.',
  whenToUse: 'Use this mode to create or extend the tour in .docugate/tour/.',
  customInstructions: `Follow the tour format in .bob/rules-${MODE_SLUG}/. Only add files for screens that have none.`,
  groups: ['read', ['edit', { fileRegex: '\\.docugate/tour/.*\\.md$', description: 'Tour files only' }]],
}

export interface BobRun {
  status: number | null
  stdout: string
  stderr: string
}

export type RunBob = (args: string[], cwd: string) => BobRun

export interface TourInitOptions {
  maxCost?: string
  teamId?: string
  runBob?: RunBob
}

export interface TourInitResult {
  setup: string[]
  added: string[]
  restored: string[]
  mode: string
  stats?: { durationMs?: number; cost?: number; taskId?: string }
  lastMessage?: string
}

export class BobMissingError extends Error {}

/** Bob Shell's headless mode signs in with an API key, not the IDE's IBMid session. */
export class BobKeyMissingError extends Error {}

const defaultRunBob: RunBob = (args, cwd) => {
  const result = spawnSync('bob', args, {
    cwd,
    encoding: 'utf8',
    // `bob` is a .cmd shim on Windows, which only runs through a shell.
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new BobMissingError('Bob Shell is not installed.')
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Adds the Tour Writer mode and its rules to the project, keeping whatever is there. */
export function ensureTourWriter(root: string): string[] {
  const created: string[] = []

  const modesPath = join(root, MODES_FILE)
  const doc = existsSync(modesPath) ? parseDocument(readFileSync(modesPath, 'utf8')) : parseDocument('customModes: []\n')
  let modes = doc.get('customModes')
  if (!isSeq(modes)) {
    doc.set('customModes', doc.createNode([]))
    modes = doc.get('customModes')
  }
  const seq = modes as { items: unknown[]; add: (v: unknown) => void }
  const present = seq.items.some((item) => isMap(item) && item.get('slug') === MODE_SLUG)
  if (!present) {
    seq.add(doc.createNode(MODE))
    mkdirSync(join(root, '.bob'), { recursive: true })
    writeFileSync(modesPath, doc.toString())
    created.push(MODES_FILE)
  }

  const rulesPath = join(root, RULES_FILE)
  if (!existsSync(rulesPath)) {
    mkdirSync(join(root, `.bob/rules-${MODE_SLUG}`), { recursive: true })
    writeFileSync(rulesPath, TOUR_RULES)
    created.push(RULES_FILE)
  }
  return created
}

function snapshot(root: string): Map<string, { text: string; hash: string }> {
  const dir = join(root, TOUR_DIR)
  const files = new Map<string, { text: string; hash: string }>()
  if (!existsSync(dir)) return files
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const text = readFileSync(join(dir, name), 'utf8')
    files.set(name, { text, hash: createHash('sha256').update(text).digest('hex') })
  }
  return files
}

export function buildPrompt(existing: string[], inlineRules: boolean): string {
  const have = existing.length
    ? `These screens already have a tour file, so leave them exactly as they are: ${existing.join(', ')}.`
    : 'There is no tour yet.'
  return [
    'Read this repository\'s frontend and backend code and write the DocuGate tour:',
    `one file in ${TOUR_DIR}/ for every screen of the app that does not have one yet.`,
    have,
    inlineRules
      ? `Follow this format and these rules exactly:\n\n${TOUR_RULES}`
      : `Follow the format and rules in ${RULES_FILE} exactly.`,
    'When you are done, list the files you wrote.',
  ].join('\n')
}

function parseBobJson(stdout: string): { stats?: TourInitResult['stats']; lastMessage?: string } {
  // --format json prints one object when the session ends; take the last line
  // that parses, in case anything was logged before it.
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const out = JSON.parse(line)
      const s = out.stats ?? {}
      const cost = typeof s.session_costs === 'number' ? s.session_costs : s.session_costs?.total
      return {
        stats: { durationMs: s.duration_ms, cost: typeof cost === 'number' ? cost : undefined, taskId: s.task_id },
        lastMessage: typeof out.last_message === 'string' ? out.last_message : undefined,
      }
    } catch {
      // not the JSON line
    }
  }
  return {}
}

// Windows reports a missing command through cmd.exe rather than as ENOENT.
const isMissing = (run: BobRun) =>
  run.status === 127 || run.status === 9009 || /not recognized as an internal or external command|command not found/i.test(run.stderr)

const looksLikeUnknownMode = (run: BobRun) => /mode/i.test(run.stderr + run.stdout) && run.status !== 0

export function tourInit(root: string, options: TourInitOptions = {}): TourInitResult {
  const runBob = options.runBob ?? defaultRunBob
  // Check for Bob before touching the project, so a failed run leaves nothing behind.
  if (isMissing(runBob(['--version'], root))) throw new BobMissingError('Bob Shell is not installed.')
  const setup = ensureTourWriter(root)
  mkdirSync(join(root, TOUR_DIR), { recursive: true })
  const before = snapshot(root)

  const common = ['run', '--format', 'json', '--workspace', root, '--max-cost', options.maxCost ?? '3']
  if (options.teamId) common.push('--team-id', options.teamId)

  let mode = MODE_SLUG
  let run = runBob([...common, '--mode', MODE_SLUG, buildPrompt([...before.keys()], false)], root)
  if (looksLikeUnknownMode(run)) {
    // Bob Shell may not load project modes. Agent mode with the rules in the
    // prompt does the same job; the snapshot below still protects user files.
    mode = 'agent'
    run = runBob([...common, '--mode', 'agent', buildPrompt([...before.keys()], true)], root)
  }
  if (run.status !== 0 && /API key is required|BOB_API_KEY/i.test(run.stderr + run.stdout)) {
    throw new BobKeyMissingError('Bob Shell needs an API key to run on its own.')
  }
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout).trim().split(/\r?\n/).slice(-5).join('\n')
    throw new Error(`Bob stopped with exit code ${run.status}.${detail ? `\n${detail}` : ''}`)
  }

  // Put back any tour file Bob changed: the user's edits always win.
  const after = snapshot(root)
  const restored: string[] = []
  for (const [name, old] of before) {
    const now = after.get(name)
    if (!now || now.hash !== old.hash) {
      writeFileSync(join(root, TOUR_DIR, name), old.text)
      restored.push(`${TOUR_DIR}/${name}`)
    }
  }
  const added = [...after.keys()].filter((name) => !before.has(name)).map((name) => `${TOUR_DIR}/${name}`)

  return { setup, added, restored, mode, ...parseBobJson(run.stdout) }
}
