import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { BobKeyMissingError, BobMissingError, buildPrompt, ensureTourWriter, tourInit } from '../dist/tour-init.js'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-tour-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const ok = (extra = {}) => ({
  status: 0,
  stderr: '',
  stdout: JSON.stringify({ status: 'completed', stats: { task_id: 't1', duration_ms: 42000, session_costs: 0.4 }, last_message: 'done', ...extra }),
})

/** A stand-in for Bob Shell: records its calls, then writes what `write` says. */
function fakeBob(root, write, { rejectCustomMode = false } = {}) {
  const calls = []
  const runBob = (args) => {
    if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' }
    calls.push(args)
    const mode = args[args.indexOf('--mode') + 1]
    if (rejectCustomMode && mode !== 'agent') return { status: 1, stdout: '', stderr: `Unknown mode: ${mode}` }
    for (const [path, content] of Object.entries(write)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    return ok()
  }
  return { calls, runBob }
}

test('tour init sets up the Tour Writer mode and reports the files Bob adds', () => {
  const dir = repo({})
  const bob = fakeBob(dir, { '.docugate/tour/home.md': '---\nroute: /\n---\n' })
  const result = tourInit(dir, { runBob: bob.runBob })

  assert.deepEqual(result.setup, ['.bob/custom_modes.yaml', '.bob/rules-tour-writer/01-tour-format.md'])
  assert.deepEqual(result.added, ['.docugate/tour/home.md'])
  assert.deepEqual(result.restored, [])
  assert.equal(result.mode, 'tour-writer')
  assert.deepEqual(result.stats, { durationMs: 42000, cost: 0.4, taskId: 't1' })

  const args = bob.calls[0]
  assert.equal(args[0], 'run')
  assert.equal(args[args.indexOf('--format') + 1], 'json')
  assert.equal(args[args.indexOf('--mode') + 1], 'tour-writer')
  assert.equal(args[args.indexOf('--max-cost') + 1], '3')

  const modes = parse(readFileSync(join(dir, '.bob/custom_modes.yaml'), 'utf8')).customModes
  const writer = modes.find((m) => m.slug === 'tour-writer')
  assert.deepEqual(writer.groups[0], 'read')
  assert.equal(writer.groups[1][1].fileRegex, '\\.docugate/tour/.*\\.md$')
})

test('tour init puts back any existing tour file Bob changed', () => {
  const mine = '---\nroute: /invoices\n---\n\n## Table\ntarget: [data-tour="invoice-table"]\n\nMy words.\n'
  const dir = repo({ '.docugate/tour/invoices.md': mine })
  const bob = fakeBob(dir, {
    '.docugate/tour/invoices.md': 'overwritten by Bob',
    '.docugate/tour/customers.md': '---\nroute: /customers\n---\n',
  })
  const result = tourInit(dir, { runBob: bob.runBob })

  assert.equal(readFileSync(join(dir, '.docugate/tour/invoices.md'), 'utf8'), mine)
  assert.deepEqual(result.restored, ['.docugate/tour/invoices.md'])
  assert.deepEqual(result.added, ['.docugate/tour/customers.md'])
  assert.match(bob.calls[0].at(-1), /invoices\.md/)
})

test('tour init falls back to agent mode with the rules inline when Bob rejects the custom mode', () => {
  const dir = repo({})
  const bob = fakeBob(dir, { '.docugate/tour/home.md': 'x' }, { rejectCustomMode: true })
  const result = tourInit(dir, { runBob: bob.runBob })

  assert.equal(result.mode, 'agent')
  assert.equal(bob.calls.length, 2)
  assert.match(bob.calls[1].at(-1), /Only claim what the code shows/)
})

test('tour init keeps an existing custom_modes.yaml and adds the mode only once', () => {
  const dir = repo({ '.bob/custom_modes.yaml': 'customModes:\n  - slug: reviewer\n    name: Reviewer\n    roleDefinition: Reviews code.\n    groups: [read]\n' })
  assert.deepEqual(ensureTourWriter(dir), ['.bob/custom_modes.yaml', '.bob/rules-tour-writer/01-tour-format.md'])
  assert.deepEqual(ensureTourWriter(dir), [])
  const slugs = parse(readFileSync(join(dir, '.bob/custom_modes.yaml'), 'utf8')).customModes.map((m) => m.slug)
  assert.deepEqual(slugs, ['reviewer', 'tour-writer'])
})

test('tour init passes the Bobcoin cap and team through, and surfaces Bob failures', () => {
  const dir = repo({})
  const calls = []
  const failing = (args) => {
    if (args[0] === '--version') return { status: 0, stdout: '1.0.0', stderr: '' }
    calls.push(args)
    return { status: 3, stdout: '', stderr: 'Budget exceeded' }
  }
  assert.throws(() => tourInit(dir, { runBob: failing, maxCost: '1', teamId: 'team-9' }), /exit code 3[\s\S]*Budget exceeded/)
  assert.equal(calls[0][calls[0].indexOf('--max-cost') + 1], '1')
  assert.equal(calls[0][calls[0].indexOf('--team-id') + 1], 'team-9')
})

test('tour init stops before changing anything when Bob Shell is missing', () => {
  const dir = repo({})
  const missing = () => ({ status: 1, stdout: '', stderr: "'bob' is not recognized as an internal or external command," })
  assert.throws(() => tourInit(dir, { runBob: missing }), BobMissingError)
  assert.ok(!existsSync(join(dir, '.bob')))
  assert.ok(!existsSync(join(dir, '.docugate')))
})

test('tour init explains the API key when Bob Shell asks for one', () => {
  const dir = repo({})
  const noKey = (args) =>
    args[0] === '--version'
      ? { status: 0, stdout: '2.0.5', stderr: '' }
      : { status: 1, stdout: '', stderr: 'Error: Bob API key is required. Set BOB_API_KEY environment variable.' }
  assert.throws(() => tourInit(dir, { runBob: noKey }), BobKeyMissingError)
})

test('the prompt points at the rules file, or carries the rules itself', () => {
  assert.match(buildPrompt([], false), /\.bob\/rules-tour-writer\/01-tour-format\.md/)
  assert.match(buildPrompt(['home.md'], true), /home\.md[\s\S]*## Rules/)
  assert.ok(BobMissingError.prototype instanceof Error)
})

test('docugate tour needs a subcommand, and other commands still reject extra words', () => {
  const dir = repo({})
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(run('tour').status, 2)
  assert.match(run('tour', 'nope').stderr, /Unknown tour command "nope"/)
  assert.match(run('check', 'extra').stderr, /Unexpected argument "extra"/)
  assert.ok(!existsSync(join(dir, '.bob')))
})
