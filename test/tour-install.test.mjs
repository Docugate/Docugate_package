import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tourInstall, hasPillSnippet } from '../dist/tour-install.js'

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-install-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

// ── Vite / plain HTML ────────────────────────────────────────────────────────

test('install inserts snippet before </body> in index.html', () => {
  const html = '<!DOCTYPE html>\n<html>\n<head><title>App</title></head>\n<body>\n<div id="app"></div>\n</body>\n</html>\n'
  const dir = repo({ 'index.html': html })
  const result = tourInstall(dir)
  assert.equal(result.target, 'index.html')
  assert.equal(result.action, 'inserted')
  const text = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.ok(text.includes('<!-- docugate:pill -->'), 'open marker present')
  assert.ok(text.includes('<!-- /docugate:pill -->'), 'close marker present')
  assert.ok(text.includes('/pill.js'), 'pill url present')
  // snippet comes before </body>
  assert.ok(text.indexOf('<!-- docugate:pill -->') < text.indexOf('</body>'))
  // rest of file untouched
  assert.ok(text.includes('<div id="app"></div>'))
})

test('install is idempotent: running twice leaves the file identical', () => {
  const html = '<html><body><div></div></body></html>'
  const dir = repo({ 'index.html': html })
  tourInstall(dir)
  const after1 = readFileSync(join(dir, 'index.html'), 'utf8')
  const result2 = tourInstall(dir)
  const after2 = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.equal(result2.action, 'already')
  assert.equal(after1, after2)
})

test('--remove strips the snippet; file returns to clean state', () => {
  const html = '<html><body><p>hi</p></body></html>'
  const dir = repo({ 'index.html': html })
  tourInstall(dir)
  const withSnippet = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.ok(withSnippet.includes('<!-- docugate:pill -->'))

  const result = tourInstall(dir, { remove: true })
  assert.equal(result.action, 'removed')
  const after = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.ok(!after.includes('docugate:pill'))
  assert.ok(after.includes('<p>hi</p>'))
})

test('--remove on a file with no snippet returns "already" (silent no-op)', () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'index.html': html })
  const result = tourInstall(dir, { remove: true })
  // The file exists and was found; remove when already absent → 'already'
  assert.equal(result.target, 'index.html')
  assert.equal(result.action, 'already')
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), html)
})

test('install picks up index.html in a sub-folder (public/) when no root index.html', () => {
  const html = '<html><body></body></html>'
  const dir = repo({ 'public/index.html': html })
  const result = tourInstall(dir)
  assert.equal(result.target, 'public/index.html')
  assert.equal(result.action, 'inserted')
})

// ── Next.js app router ───────────────────────────────────────────────────────

const LAYOUT_TSX = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`

test('install inserts JSX snippet in app/layout.tsx before </body>', () => {
  const dir = repo({ 'app/layout.tsx': LAYOUT_TSX })
  const result = tourInstall(dir, { port: 4178 })
  assert.equal(result.target, 'app/layout.tsx')
  assert.equal(result.action, 'inserted')
  const text = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
  assert.ok(text.includes('{/* docugate:pill */}'), 'JSX open marker present')
  assert.ok(text.includes('{/* /docugate:pill */}'), 'JSX close marker present')
  assert.ok(text.includes("process.env.NODE_ENV === 'development'"), 'dev check present')
  assert.ok(text.includes('src="http://localhost:4178/pill.js"'), 'pill URL present')
  assert.ok(text.indexOf('{/* docugate:pill */}') < text.indexOf('</body>'), 'before </body>')
})

test('install in app/layout.tsx is idempotent', () => {
  const dir = repo({ 'app/layout.tsx': LAYOUT_TSX })
  tourInstall(dir)
  const after1 = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
  const result2 = tourInstall(dir)
  const after2 = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
  assert.equal(result2.action, 'already')
  assert.equal(after1, after2)
})

test('--remove strips JSX snippet from app/layout.tsx', () => {
  const dir = repo({ 'app/layout.tsx': LAYOUT_TSX })
  tourInstall(dir)
  const result = tourInstall(dir, { remove: true })
  assert.equal(result.action, 'removed')
  const after = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
  assert.ok(!after.includes('docugate:pill'))
  assert.ok(after.includes('<body>'))
})

// ── Next.js pages router ────────────────────────────────────────────────────

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

test('install inserts JSX snippet in pages/_document.tsx before </body>', () => {
  const dir = repo({ 'pages/_document.tsx': DOCUMENT_TSX })
  const result = tourInstall(dir, { port: 9000 })
  assert.equal(result.target, 'pages/_document.tsx')
  assert.equal(result.action, 'inserted')
  const text = readFileSync(join(dir, 'pages/_document.tsx'), 'utf8')
  assert.ok(text.includes('{/* docugate:pill */}'))
  assert.ok(text.includes('src="http://localhost:9000/pill.js"'))
  assert.ok(text.indexOf('{/* docugate:pill */}') < text.indexOf('</body>'))
})

// ── Nothing found ────────────────────────────────────────────────────────────

test('returns { target: null, action: "none" } when no entry point exists', () => {
  const dir = repo({ 'src/main.ts': 'console.log("hi")' })
  const result = tourInstall(dir)
  assert.equal(result.target, null)
  assert.equal(result.action, 'none')
})

// ── hasPillSnippet ───────────────────────────────────────────────────────────

test('hasPillSnippet returns false before install, true after', () => {
  const dir = repo({ 'index.html': '<html><body></body></html>' })
  assert.equal(hasPillSnippet(dir), false)
  tourInstall(dir)
  assert.equal(hasPillSnippet(dir), true)
})

test('hasPillSnippet returns false when no candidate files exist', () => {
  const dir = repo({})
  assert.equal(hasPillSnippet(dir), false)
})

test('hasPillSnippet recognises JSX marker in layout file', () => {
  const dir = repo({ 'app/layout.tsx': LAYOUT_TSX })
  assert.equal(hasPillSnippet(dir), false)
  tourInstall(dir)
  assert.equal(hasPillSnippet(dir), true)
})

// ── custom port ──────────────────────────────────────────────────────────────

test('install uses the specified port in the snippet URL', () => {
  const dir = repo({ 'index.html': '<html><body></body></html>' })
  tourInstall(dir, { port: 3333 })
  const text = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.ok(text.includes('localhost:3333/pill.js'))
})

// ---------------------------------------------------------------------------
// The tour server starts with the app: a predev (or prestart) script
// ---------------------------------------------------------------------------

test('install adds predev so npm run dev starts the tour server, once', async () => {
  const { installStartHook, SERVE_HOOK } = await import('../dist/tour-install.js')
  const dir = mkdtempSync(join(tmpdir(), 'docugate-hook-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }, null, 2) + '\n')
  assert.deepEqual(installStartHook(dir), { hook: 'predev', action: 'inserted' })
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.predev, SERVE_HOOK)
  assert.equal(installStartHook(dir).action, 'already')
  assert.equal(installStartHook(dir, { remove: true }).action, 'removed')
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.predev, undefined)
})

test('an existing predev keeps running first; npm start apps get prestart', async () => {
  const { installStartHook, SERVE_HOOK } = await import('../dist/tour-install.js')
  const dir = mkdtempSync(join(tmpdir(), 'docugate-hook-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev', predev: 'node gen.js' } }))
  installStartHook(dir)
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.predev, `node gen.js && ${SERVE_HOOK}`)
  installStartHook(dir, { remove: true })
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.predev, 'node gen.js')

  const cra = mkdtempSync(join(tmpdir(), 'docugate-hook-'))
  writeFileSync(join(cra, 'package.json'), JSON.stringify({ scripts: { start: 'react-scripts start' } }))
  assert.equal(installStartHook(cra).hook, 'prestart')
})
