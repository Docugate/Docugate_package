import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CREDENTIALS_DIR = join(homedir(), '.docugate')
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json')

export type Credentials = { token: string }

export function credentialsPath(): string {
  return CREDENTIALS_FILE
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = readFileSync(CREDENTIALS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.token === 'string') return { token: obj.token }
    }
  } catch {
    // missing, unreadable, or not valid JSON
  }
  return null
}

export function saveCredentials(token: string): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true })
  writeFileSync(CREDENTIALS_FILE, JSON.stringify({ token }) + '\n', { mode: 0o600 })
}

export function clearCredentials(): void {
  rmSync(CREDENTIALS_FILE, { force: true })
}

// ---------------------------------------------------------------------------
// Browser-based login
// ---------------------------------------------------------------------------

function openBrowserDefault(url: string): void {
  // Not `cmd /c start`: cmd reads the `&` between query parameters as a second
  // command, so the browser got the URL cut off after `port=` and the site
  // refused the link. rundll32 hands the URL over untouched.
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

export interface LoginOptions {
  /** Override the browser-open function (used in tests). */
  openBrowser?: (url: string) => void
  /** Override the timeout in ms (used in tests; default 5 minutes). */
  timeoutMs?: number
}

/**
 * Opens the browser at `baseUrl/api/auth/cli?port=…&state=…`, starts a local
 * HTTP server to receive the callback, saves the token, and resolves once the
 * user completes sign-in. Rejects after `timeoutMs` (default 5 minutes).
 */
export function login(baseUrl: string, opts: LoginOptions = {}): Promise<{ token: string }> {
  const openBrowser = opts.openBrowser ?? openBrowserDefault
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000

  const state = randomBytes(24).toString('base64url')
  // Must match cliCode() on the website character for character, or the page
  // tells the person their codes differ when nothing is wrong.
  const code = `${state.slice(0, 4)}-${state.slice(4, 8)}`.toUpperCase()

  return new Promise<{ token: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const u = new URL(req.url ?? '/', `http://127.0.0.1`)
        if (u.pathname !== '/callback') {
          res.writeHead(404).end('Not found')
          return
        }
        // The browser is sent back to the website's own finish page, so every
        // screen of the sign-in looks like DocuGate rather than a bare local one.
        const done = `${baseUrl}/api/auth/cli/done`
        const token = u.searchParams.get('token') ?? ''
        if (u.searchParams.get('state') !== state || !token) {
          res.writeHead(302, { Location: `${done}?error=state` }).end()
          return
        }
        res.writeHead(302, { Location: done }).end()
        clearTimeout(timer)
        server.close()
        saveCredentials(token)
        resolve({ token })
      } catch (err) {
        res.writeHead(500).end('Internal error')
        reject(err as Error)
      }
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out after 5 minutes.'))
    }, timeoutMs)

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      const url = `${baseUrl}/api/auth/cli?port=${port}&state=${state}`
      console.log(`\nOpen this URL to sign in:\n  ${url}\n\nConfirmation code: ${code}\n`)
      openBrowser(url)
    })
  })
}
