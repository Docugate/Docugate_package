#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from './check.js'
import { loadConfig } from './config.js'
import type { Issue } from './config.js'
import { initFlow } from './init.js'
import type { Role } from './init.js'
import { buildOpenApi, isCurrent, writeOpenApi } from './openapi.js'
import { BobKeyMissingError, BobMissingError, tourInit } from './tour-init.js'
import { tourInstall, hasPillSnippet, pillSnippetLine, DEFAULT_PORT } from './tour-install.js'
import { loadTours } from './tour.js'
import { startTourServer } from './tour-server.js'
import { login, clearCredentials, loadCredentials } from './auth.js'
import { BASE_URL, getSession } from './api.js'

const SITE = 'https://www.trydocugate.site'

const HELP = `docugate: set up and check the docs DocuGate reads from your repository

Usage
  docugate <command> [options]

Commands
  init              Set up this repository for DocuGate (interactive)
  login             Sign in to DocuGate with GitHub
  logout            Sign out and delete saved credentials
  whoami            Print the currently signed-in user
  check             Check the docs the way DocuGate will read them
  openapi           Prepare an OpenAPI spec for DocuGate's API reference
  tour init         Write the first tour of this app with IBM Bob
  tour install      Add the pill loader to your app
  tour serve        Start a local server that serves tour data for the pill
  tour export       Write every tour screen to a single JSON file

init
  --dir <folder>       Docs folder (default: docs)
  --title <text>       Space title (default: this folder's name)
  --role <role>        Repository role: frontend, backend, or both
  --yes                Accept every default without asking

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

tour init
  --max-cost <n>       Most Bobcoins the run may spend (default: 3)
  --team-id <id>       Bob team to run under, for API keys that need one

tour install
  --port <n>           Port the pill server listens on (default: 4178)
  --remove             Remove the pill snippet instead of adding it

tour serve
  --port <n>           Port to listen on (default: 4178)

tour export <file>
  Write all tour screens to <file> as JSON.

Run it from the root of your repository.
${SITE}
`

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = (t: string) => paint(31, t)
const yellow = (t: string) => paint(33, t)
const green = (t: string) => paint(32, t)
const dim = (t: string) => paint(2, t)

type Args = { command?: string; sub?: string; sub2?: string; flags: Map<string, string[]>; bools: Set<string> }

const VALUE_FLAGS = new Set(['dir', 'title', 'role', 'from', 'out', 'include', 'exclude', 'redact', 'max-cost', 'team-id', 'port'])

function parse(argv: string[]): Args {
  const flags = new Map<string, string[]>()
  const bools = new Set<string>()
  let command: string | undefined
  let sub: string | undefined
  let sub2: string | undefined

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
    else if (command === 'tour' && !sub) sub = arg
    else if (command === 'tour' && sub === 'export' && !sub2) sub2 = arg
    else fail(`Unexpected argument "${arg}".`)
  }
  return { command, sub, sub2, flags, bools }
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
    case 'login': {
      const creds = loadCredentials()
      if (creds) {
        // Already signed in — confirm with the server.
        try {
          const { user } = await getSession()
          if (user) {
            console.log(`Already signed in as @${user.githubLogin}`)
            return
          }
        } catch {
          // server unreachable; proceed to sign in again
        }
      }
      const { token } = await login(BASE_URL, args.bools.has('yes') ? {} : {})
      try {
        const { user } = await getSession()
        if (user) {
          console.log(`Signed in as @${user.githubLogin}`)
        } else {
          console.log('Signed in.')
        }
      } catch {
        // token saved; just confirm
        console.log('Signed in.')
      }
      void token
      return
    }

    case 'logout': {
      clearCredentials()
      console.log('Signed out.')
      return
    }

    case 'whoami': {
      const creds = loadCredentials()
      if (!creds) {
        console.log('Not signed in. Run docugate login.')
        return
      }
      let session
      try {
        session = await getSession()
      } catch (err) {
        console.error(`Signed in, but couldn't reach DocuGate to confirm who you are: ${(err as Error).message}`)
        process.exitCode = 1
        return
      }
      if (session.user) {
        console.log(`@${session.user.githubLogin}`)
      } else {
        console.log('Not signed in. Run docugate login.')
      }
      return
    }

    case 'init': {
      const roleFlag = one('role') as Role | undefined
      if (roleFlag && !['frontend', 'backend', 'both'].includes(roleFlag)) {
        fail(`--role must be frontend, backend, or both.`)
      }
      const port = one('port') !== undefined ? parseInt(one('port')!, 10) : DEFAULT_PORT
      const result = await initFlow(root, {
        dir: one('dir'),
        title: one('title'),
        role: roleFlag,
        yes: args.bools.has('yes'),
        port,
      })
      // The Tour button only shows while the tour server runs, so setup starts
      // it in the background instead of asking: the next thing the person
      // does is open their app, and the button is there.
      const where = result.alreadySetUp ?? root
      const hasTour = result.role === 'frontend' || result.role === 'both'
      if (hasTour && !args.bools.has('no-serve')) {
        const started = await startServerInBackground(where, port)
        console.log(dim(started
          ? `    The tour server is running in the background (port ${port}). After a restart: docugate tour serve`
          : `    Start the tour server with docugate tour serve, then open your app.`))
      }
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

    case 'tour': {
      switch (args.sub) {
        case 'install': {
          const port = parseInt(one('port') ?? String(DEFAULT_PORT), 10)
          const remove = args.bools.has('remove')
          const result = tourInstall(root, { port, remove })
          if (result.target === null) {
            console.log(`  ${yellow('not found')}  No supported HTML or layout file found.`)
            console.log(`  Paste this into your app's HTML during development:`)
            console.log(`    ${pillSnippetLine(port)}`)
          } else if (result.action === 'inserted') {
            console.log(`  ${green('installed')}  ${result.target}`)
          } else if (result.action === 'removed') {
            console.log(`  ${green('removed')}   ${result.target}`)
          } else {
            // already / no-op
            console.log(`  ${dim('unchanged')}  ${result.target}`)
          }
          return
        }

        case 'init': {
          console.log(`${dim('Bob is reading your code and writing the tour. This takes a minute or two.')}`)
          let result
          try {
            result = tourInit(root, { maxCost: one('max-cost'), teamId: one('team-id') })
          } catch (error) {
            if (error instanceof BobKeyMissingError) {
              console.error(
                `${red('error')} Bob Shell needs an API key to run on its own (your IDE sign-in is not used here).
` +
                  `1. At https://bob.ibm.com, open your instance, then API keys, and create an Inference key.
` +
                  `2. Save it as the BOB_API_KEY environment variable, then open a new terminal:
` +
                  `     PowerShell   [Environment]::SetEnvironmentVariable("BOB_API_KEY", "<key>", "User")
` +
                  `     macOS/Linux  export BOB_API_KEY=<key>   (add it to your shell profile)
` +
                  dim('Keep the key out of your repository. https://bob.ibm.com/docs/ide/account/api-keys'),
              )
              process.exit(2)
            }
            if (!(error instanceof BobMissingError)) throw error
            console.error(
              `${red('error')} Bob Shell is not installed, and tours are written by IBM Bob.
` +
                `Install it (Node 24 or later), sign in, then run this again:
` +
                `  Windows      powershell -c "irm -Uri https://bob.ibm.com/download/bobshell.ps1 | iex"
` +
                `  macOS/Linux  curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
` +
                dim('https://bob.ibm.com/docs/shell/getting-started/install-and-setup'),
            )
            process.exit(2)
          }
          for (const f of result.setup) console.log(`  ${green('created')}  ${f}`)
          for (const f of result.added) console.log(`  ${green('added')}    ${f}`)
          for (const f of result.restored) console.log(`  ${yellow('kept')}     ${f} ${dim('(Bob changed it; your version was put back)')}`)
          if (!result.added.length) console.log(`  ${dim('No new screens: every screen Bob found already has a tour file.')}`)

          const stats = result.stats
          const parts = [
            result.mode === 'agent' ? 'agent mode' : 'Tour Writer mode',
            stats?.durationMs !== undefined ? `${Math.round(stats.durationMs / 1000)}s` : '',
            stats?.cost !== undefined ? `${stats.cost} Bobcoins` : '',
          ].filter(Boolean)
          console.log(`
${dim(`Bob: ${parts.join(', ')}`)}`)
          console.log('Next: read the new files, fix anything Bob got wrong, and commit them. They are yours now.')
          return
        }

        case 'serve': {
          await serveTour(root, parseInt(one('port') ?? '4178', 10))
          return
        }

        case 'export': {
          const outFile = args.sub2
          if (!outFile) fail('Say where to write: docugate tour export <file>.')
          const screens = loadTours(root)
          const json = JSON.stringify(screens.map(({ route, title, stops }) => ({ route, title, stops })), null, 2)
          writeFileSync(outFile, json)
          console.log(`${green('wrote')}  ${outFile} ${dim(`(${plural(screens.length, 'screen')})`)}`)
          return
        }

        default:
          fail(args.sub ? `Unknown tour command "${args.sub}".` : 'Say which: docugate tour init, tour install, or tour serve.')
      }
    }

    default:
      fail(`Unknown command "${args.command}".`)
  }
}

main().catch((error: Error) => {
  console.error(`${red('error')} ${error.message}`)
  process.exit(1)
})

/**
 * Starts `docugate tour serve` detached, so it outlives this command. When one
 * is already answering on the port, that one is kept. True when a server is
 * answering afterwards.
 */
async function startServerInBackground(root: string, port: number): Promise<boolean> {
  const answering = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/pill.js`, { signal: AbortSignal.timeout(800) })
      return res.ok
    } catch {
      return false
    }
  }
  if (await answering()) return true
  const child = spawn(process.execPath, [process.argv[1], 'tour', 'serve', '--port', String(port)], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150))
    if (await answering()) return true
  }
  return false
}

/**
 * Serves the tour to the pill until Ctrl-C. Starts even when there is no tour
 * yet: the pill then shows on every page, and its inspector writes the first
 * step, so a failed or skipped AI step never leaves the app without it.
 */
async function serveTour(root: string, port: number): Promise<void> {
  mkdirSync(join(root, '.docugate', 'tour'), { recursive: true })
  const server = await startTourServer(root, port)
  const url = `http://localhost:${server.port}`
  const screens = loadTours(root)
  console.log(`${green('Tour server')}  ${url}`)
  if (screens.length) {
    console.log(`${plural(screens.length, 'screen')} loaded from .docugate/tour/`)
  } else {
    console.log(`No tour yet. Open your app: the pill shows on every page, and its Inspector adds the first step.`)
  }
  if (!hasPillSnippet(root)) {
    console.log(`${dim('Hint: run')} ${green('docugate tour install')} ${dim('to add the pill to your app automatically.')}`)
  }
  console.log(dim('Leave this running while you work. Ctrl-C stops it.'))
  process.on('SIGINT', () => { server.close(); process.exit(0) })
  process.on('SIGTERM', () => { server.close(); process.exit(0) })
  await new Promise(() => { /* run until signal */ })
}
