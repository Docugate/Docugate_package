#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { check } from './check.js'
import { loadConfig } from './config.js'
import type { Issue } from './config.js'
import { init } from './init.js'
import { buildOpenApi, isCurrent, writeOpenApi } from './openapi.js'

const SITE = 'https://www.trydocugate.site'

const HELP = `docugate: set up and check the docs DocuGate reads from your repository

Usage
  docugate <command> [options]

Commands
  init        Set up this repository for DocuGate
  check       Check the docs the way DocuGate will read them
  openapi     Prepare an OpenAPI spec for DocuGate's API reference

init
  --dir <folder>       Docs folder (default: docs)
  --title <text>       Space title (default: this folder's name)

check
  --dir <folder>       Check this folder instead of docugate.json's docsDir
  --strict             Treat warnings as errors

openapi
  --from <file|url>    The spec to read (or api.generate.from in docugate.json)
  --out <file>         Where to write it (default: openapi.json)
  --include <glob>     Keep only paths that match; repeatable
  --exclude <glob>     Drop paths that match; repeatable
  --redact <name>      Remove a property from every schema and example; repeatable
  --check              Fail if the file is out of date, instead of writing it

Run it from the root of your repository.
${SITE}
`

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = (t: string) => paint(31, t)
const yellow = (t: string) => paint(33, t)
const green = (t: string) => paint(32, t)
const dim = (t: string) => paint(2, t)

type Args = { command?: string; flags: Map<string, string[]>; bools: Set<string> }

const VALUE_FLAGS = new Set(['dir', 'title', 'from', 'out', 'include', 'exclude', 'redact'])

function parse(argv: string[]): Args {
  const flags = new Map<string, string[]>()
  const bools = new Set<string>()
  let command: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h') bools.add('help')
    else if (arg === '-v') bools.add('version')
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2)
      if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[++i]
        if (value === undefined) fail(`--${name} needs a value.`)
        flags.set(name, [...(flags.get(name) ?? []), value])
      } else bools.add(name)
    } else if (!command) command = arg
    else fail(`Unexpected argument "${arg}".`)
  }
  return { command, flags, bools }
}

function fail(message: string): never {
  // Phrased without a command name on purpose: this is the message somebody
  // sees when they are already stuck, and it would be wrong for half of them.
  // `docugate --help` is not a thing you can run if you reached this through
  // npx, and `npx docugate --help` is not one if you installed it.
  console.error(`${red('error')} ${message}\n${dim('See --help for usage.')}`)
  process.exit(2)
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version as string
}

function report(label: string, issues: Issue[], paintLabel: (t: string) => string) {
  for (const issue of issues) {
    console.log(`  ${paintLabel(label.padEnd(5))}  ${issue.file ? `${issue.file} ` : ''}${issue.message}`)
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function main() {
  const args = parse(process.argv.slice(2))
  const one = (name: string) => args.flags.get(name)?.at(-1)
  const many = (name: string) => args.flags.get(name) ?? []
  const root = process.cwd()

  if (args.bools.has('version')) return console.log(version())
  if (args.bools.has('help') || !args.command) return console.log(HELP)

  switch (args.command) {
    case 'init': {
      const result = init(root, { dir: one('dir'), title: one('title') })
      for (const f of result.created) console.log(`  ${green('created')}  ${f}`)
      for (const f of result.kept) console.log(`  ${dim('kept')}     ${f}`)
      console.log(
        `\nNext: commit and push, then publish the space at ${SITE}/dashboard/new` +
          `\nand pick "${result.docsDir}" as the docs folder.`,
      )
      return
    }

    case 'check': {
      const result = check(root, one('dir'))
      const strict = args.bools.has('strict')
      console.log(`docugate check ${dim(`(${result.docsDir}/, ${plural(result.pages, 'page')})`)}`)
      report('error', result.errors, red)
      report('warn', result.warnings, yellow)

      const failed = result.errors.length + (strict ? result.warnings.length : 0)
      if (!result.errors.length && !result.warnings.length) console.log(green('\nNo problems.'))
      else console.log(`\n${plural(result.errors.length, 'error')}, ${plural(result.warnings.length, 'warning')}`)
      if (failed) process.exitCode = 1
      return
    }

    case 'openapi': {
      const generate = loadConfig(root).config.api?.generate ?? {}
      const from = one('from') ?? generate.from
      if (!from) fail('Say which spec to read: --from openapi.yaml, or api.generate.from in docugate.json.')
      const output = one('out') ?? generate.output ?? 'openapi.json'
      const result = await buildOpenApi(root, {
        from,
        output,
        include: args.flags.has('include') ? many('include') : (generate.include ?? []),
        exclude: args.flags.has('exclude') ? many('exclude') : (generate.exclude ?? []),
        redact: args.flags.has('redact') ? many('redact') : (generate.redact ?? []),
      })

      const summary =
        `${plural(result.operations, 'operation')}` +
        (result.droppedPaths.length ? `, ${plural(result.droppedPaths.length, 'path')} left out` : '') +
        (result.redacted ? `, ${plural(result.redacted, 'field')} redacted` : '')

      if (args.bools.has('check')) {
        if (isCurrent(root, output, result.text)) {
          console.log(`${green('up to date')}  ${output} ${dim(`(${summary})`)}`)
        } else {
          console.log(`${red('out of date')}  ${output} does not match ${from}.`)
          console.log(dim('Run `docugate openapi` and commit the result.'))
          process.exitCode = 1
        }
        return
      }

      writeOpenApi(root, output, result.text)
      console.log(`${green('wrote')}  ${output} ${dim(`(${summary})`)}`)
      return
    }

    default:
      fail(`Unknown command "${args.command}".`)
  }
}

main().catch((error: Error) => {
  console.error(`${red('error')} ${error.message}`)
  process.exit(1)
})
