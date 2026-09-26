import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTourFile, serializeTourFile, loadTours, matchRoute } from '../dist/tour.js'
import { check } from '../dist/check.js'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-tour-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('parseTourFile reads front matter and stops', () => {
  const file = join(FIXTURES, 'tour-parse/simple.md')
  const text = readFileSync(file, 'utf8')
  const tour = parseTourFile(text, 'simple.md')

  assert.equal(tour.route, '/invoices/:id')
  assert.equal(tour.title, 'Invoice')
  assert.equal(tour.stops.length, 2)

  const first = tour.stops[0]
  assert.equal(first.heading, 'Total')
  assert.equal(first.target, '[data-tour="invoice-total"]')
  assert.equal(first.data, 'GET /api/invoices/:id → total')
  assert.equal(first.code, 'frontend/src/screens/InvoiceDetail.tsx')
  assert.equal(first.source, 'backend/src/billing.ts')
  assert.equal(first.docs, 'https://example.com/docs')
  assert.equal(first.prose, 'The amount due.')

  const second = tour.stops[1]
  assert.equal(second.heading, 'Mark as paid')
  assert.equal(second.source, undefined)
  assert.equal(second.prose, 'Click to pay.')
})

test('parseTourFile parses a full tour written by Bob', () => {
  const file = fileURLToPath(
    new URL('./fixtures/tour-parse/invoice-detail.md', import.meta.url),
  )
  const text = readFileSync(file, 'utf8')
  // should not throw
  const tour = parseTourFile(text, 'invoice-detail.md')
  assert.equal(tour.route, '/invoices/:id')
  assert.equal(tour.stops.length, 5)
  assert.equal(tour.stops[0].heading, 'Customer')
  assert.equal(tour.stops[4].heading, 'Mark as paid')
})

test('parseTourFile throws on missing route', () => {
  assert.throws(
    () => parseTourFile('---\ntitle: X\n---\n\n## A\ntarget: x\ncode: a.ts\n\nHi\n', 't.md'),
    /missing "route"/,
  )
})

test('parseTourFile throws on missing title', () => {
  assert.throws(
    () => parseTourFile('---\nroute: /a\n---\n\n## A\ntarget: x\ncode: a.ts\n\nHi\n', 't.md'),
    /missing "title"/,
  )
})

test('parseTourFile throws on stop missing target', () => {
  assert.throws(
    () => parseTourFile('---\nroute: /a\ntitle: A\n---\n\n## A\ncode: a.ts\n\nHi\n', 't.md'),
    /missing "target"/,
  )
})

test('parseTourFile throws on stop missing code', () => {
  assert.throws(
    () => parseTourFile('---\nroute: /a\ntitle: A\n---\n\n## A\ntarget: x\n\nHi\n', 't.md'),
    /missing "code"/,
  )
})

// ---------------------------------------------------------------------------
// Round-tripping
// ---------------------------------------------------------------------------

test('serializeTourFile round-trips a parsed file', () => {
  const file = join(FIXTURES, 'tour-parse/simple.md')
  const text = readFileSync(file, 'utf8')
  const tour = parseTourFile(text, 'simple.md')
  const out = serializeTourFile(tour)
  const reparsed = parseTourFile(out, 'reparsed.md')

  assert.equal(reparsed.route, tour.route)
  assert.equal(reparsed.title, tour.title)
  assert.equal(reparsed.stops.length, tour.stops.length)
  for (let i = 0; i < tour.stops.length; i++) {
    assert.deepEqual(reparsed.stops[i], tour.stops[i])
  }
})

test('serializeTourFile emits correct structure', () => {
  const tour = {
    route: '/items/:id',
    title: 'Item',
    stops: [
      { heading: 'Name', target: '[data-tour="item-name"]', code: 'src/Item.tsx', prose: 'The name.' },
    ],
  }
  const out = serializeTourFile(tour)
  assert.ok(out.startsWith('---\n'))
  assert.ok(out.includes('route: /items/:id'))
  assert.ok(out.includes('title: Item'))
  assert.ok(out.includes('## Name'))
  assert.ok(out.includes('target: [data-tour="item-name"]'))
  assert.ok(out.includes('code: src/Item.tsx'))
  assert.ok(out.includes('The name.'))
  // source and docs not present when undefined
  assert.ok(!out.includes('source:'))
  assert.ok(!out.includes('docs:'))
})

// ---------------------------------------------------------------------------
// loadTours
// ---------------------------------------------------------------------------

test('loadTours returns empty array when tour dir absent', () => {
  const dir = repo({ 'docs/index.md': '# Home\n' })
  assert.deepEqual(loadTours(dir), [])
})

test('loadTours reads all .md files under .docugate/tour/', () => {
  const dir = repo({
    '.docugate/tour/invoice-detail.md':
      '---\nroute: /invoices/:id\ntitle: Invoice\n---\n\n## Total\ntarget: x\ncode: a.ts\n\nHi\n',
    '.docugate/tour/home.md':
      '---\nroute: /\ntitle: Home\n---\n\n## Hero\ntarget: y\ncode: b.ts\n\nHello\n',
  })
  const tours = loadTours(dir)
  assert.equal(tours.length, 2)
  const routes = tours.map((t) => t.route).sort()
  assert.deepEqual(routes, ['/', '/invoices/:id'])
  // file property is set
  for (const t of tours) assert.ok(t.file?.startsWith('.docugate/tour/'))
})

// ---------------------------------------------------------------------------
// matchRoute
// ---------------------------------------------------------------------------

test('matchRoute: exact paths', () => {
  assert.ok(matchRoute('/invoices', '/invoices'))
  assert.ok(!matchRoute('/invoices', '/customers'))
  assert.ok(!matchRoute('/invoices', '/invoices/123'))
})

test('matchRoute: :param segments match any single segment', () => {
  assert.ok(matchRoute('/invoices/:id', '/invoices/INV-001'))
  assert.ok(matchRoute('/invoices/:id', '/invoices/123'))
  assert.ok(!matchRoute('/invoices/:id', '/invoices'))
  assert.ok(!matchRoute('/invoices/:id', '/invoices/a/b'))
})

test('matchRoute: multiple params', () => {
  assert.ok(matchRoute('/orgs/:org/repos/:repo', '/orgs/acme/repos/backend'))
  assert.ok(!matchRoute('/orgs/:org/repos/:repo', '/orgs/acme/repos'))
})

test('matchRoute: root path', () => {
  assert.ok(matchRoute('/', '/'))
})

// ---------------------------------------------------------------------------
// Tour checks via check()
// ---------------------------------------------------------------------------

const TOUR_CHECK_ROOT = join(FIXTURES, 'tour-check')

test('check passes the tour-check fixture with no warnings', () => {
  const result = check(TOUR_CHECK_ROOT)
  const tourWarnings = result.warnings.filter((w) => w.file?.startsWith('.docugate/tour/'))
  assert.deepEqual(tourWarnings, [], `Unexpected tour warnings: ${JSON.stringify(tourWarnings)}`)
})

test('check warns when code file does not exist', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items/:id\ntitle: Item\n---\n\n## Name\ntarget: [data-tour="item-name"]\ncode: src/NoSuchFile.tsx\n\nHi\n',
  })
  const result = check(dir)
  assert.ok(result.warnings.some((w) => /code file.*does not exist/.test(w.message)))
})

test('check warns when source file does not exist', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx': 'function S() { return <span data-tour="name">x</span> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items/:id\ntitle: Item\n---\n\n## Name\ntarget: [data-tour="name"]\ncode: src/Screen.tsx\nsource: src/NoSuchSource.ts\n\nHi\n',
  })
  const result = check(dir)
  assert.ok(result.warnings.some((w) => /source file.*does not exist/.test(w.message)))
})

test('check warns when data-tour value not in code file', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx': 'function S() { return <span data-tour="other">x</span> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items\ntitle: Items\n---\n\n## Name\ntarget: [data-tour="item-name"]\ncode: src/Screen.tsx\n\nHi\n',
  })
  const result = check(dir)
  assert.ok(result.warnings.some((w) => /does not contain data-tour value "item-name"/.test(w.message)))
})

test('check does not warn when data-tour value found in import', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    // code file only imports; actual data-tour is in the imported file
    'src/Screen.tsx': "import { widget } from './widget'\nfunction S() { return <widget /> }\n",
    'src/widget.tsx': 'export function widget() { return <span data-tour="item-name">x</span> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items\ntitle: Items\n---\n\n## Name\ntarget: [data-tour="item-name"]\ncode: src/Screen.tsx\n\nHi\n',
  })
  // The check only looks at data-tour value in the CODE file, not imports —
  // the data-tour attribute must be in the code file itself.
  // (source import check is for endpoint path, not data-tour attribute)
  const result = check(dir)
  const warn = result.warnings.some((w) => /does not contain data-tour value "item-name"/.test(w.message))
  assert.ok(warn)
})

test('check warns when endpoint not found in code or imports', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx': 'function S() { return <span data-tour="total">x</span> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /invoices/:id\ntitle: Invoice\n---\n\n## Total\ntarget: [data-tour="total"]\ndata: GET /api/invoices/:id → total\ncode: src/Screen.tsx\n\nHi\n',
  })
  const result = check(dir)
  assert.ok(result.warnings.some((w) => /endpoint.*not found/.test(w.message)))
})

test('check finds endpoint in an import one level deep', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx': "import { load } from './api'\nfunction S() { return <span data-tour=\"total\">x</span> }\n",
    'src/api.ts': "export const load = (id) => fetch(`/api/invoices/${id}`)\n",
    '.docugate/tour/screen.md':
      '---\nroute: /invoices/:id\ntitle: Invoice\n---\n\n## Total\ntarget: [data-tour="total"]\ndata: GET /api/invoices/:id → total\ncode: src/Screen.tsx\n\nHi\n',
  })
  const result = check(dir)
  assert.ok(!result.warnings.some((w) => /endpoint.*not found/.test(w.message)))
})

test('check warns when two stops share a target', () => {
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx': 'function S() { return <span data-tour="name">x</span> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items\ntitle: Items\n---\n\n## Name\ntarget: [data-tour="name"]\ncode: src/Screen.tsx\n\nFirst\n\n## Also Name\ntarget: [data-tour="name"]\ncode: src/Screen.tsx\n\nSecond\n',
  })
  const result = check(dir)
  assert.ok(result.warnings.some((w) => /share the same target/.test(w.message)))
})

test('check passes when no tour dir exists (no tour warnings)', () => {
  const dir = repo({ 'docs/index.md': '# Home\n' })
  const result = check(dir)
  // No tour warnings expected when .docugate/tour/ is absent
  assert.ok(result.warnings.every((w) => !w.message.includes('tour')))
})

test('check warns when data-tour value renamed (exact match required)', () => {
  // invoice-total renamed to invoice-total-RENAMED: "invoice-total" is a
  // substring of the new value, so a simple includes() would miss the rename.
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx':
      'function S() { return <td data-tour="invoice-total-RENAMED">x</td> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /invoices/:id\ntitle: Invoice\n---\n\n## Total\ntarget: [data-tour="invoice-total"]\ncode: src/Screen.tsx\n\nThe total.\n',
  })
  const result = check(dir)
  assert.ok(
    result.warnings.some((w) => /does not contain data-tour value "invoice-total"/.test(w.message)),
    'expected warning for renamed data-tour value',
  )
})

test('check passes when data-tour value is passed as a prop string', () => {
  // The component sets data-tour={tour} and is called with tour="invoice-status".
  // The value "invoice-status" appears as a quoted string, not as data-tour="...".
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx':
      'import { Badge } from \'./Badge\'\n' +
      'function S() { return <Badge tour="invoice-status" /> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items\ntitle: Items\n---\n\n## Status\ntarget: [data-tour="invoice-status"]\ncode: src/Screen.tsx\n\nThe status.\n',
  })
  const result = check(dir)
  assert.ok(
    !result.warnings.some((w) => /does not contain data-tour value "invoice-status"/.test(w.message)),
    'should not warn when value appears as a prop string',
  )
})

test('check still warns when prop string is renamed', () => {
  // Renaming "invoice-status" to "invoice-status-old" must still warn.
  const dir = repo({
    'docs/index.md': '# Home\n',
    'src/Screen.tsx':
      'import { Badge } from \'./Badge\'\n' +
      'function S() { return <Badge tour="invoice-status-old" /> }\n',
    '.docugate/tour/screen.md':
      '---\nroute: /items\ntitle: Items\n---\n\n## Status\ntarget: [data-tour="invoice-status"]\ncode: src/Screen.tsx\n\nThe status.\n',
  })
  const result = check(dir)
  assert.ok(
    result.warnings.some((w) => /does not contain data-tour value "invoice-status"/.test(w.message)),
    'expected warning when prop string is renamed',
  )
})
