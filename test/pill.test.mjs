// test/pill.test.mjs — tests for pill utilities runnable in Node (no browser)
// Imports the compiled helpers from pill/dist/ts/pill.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ---------------------------------------------------------------------------
// Import compiled helpers
// We import directly from the TS-compiled module output.
// ---------------------------------------------------------------------------

const pillModule = await import('../pill/dist/ts/pill.js')
const { matchRoute, suggestSelector } = pillModule

// ---------------------------------------------------------------------------
// matchRoute — pure function, no DOM needed
// ---------------------------------------------------------------------------

test('matchRoute: exact root', () => {
  assert.equal(matchRoute('/', '/'), true)
})

test('matchRoute: static single segment', () => {
  assert.equal(matchRoute('/invoices', '/invoices'), true)
})

test('matchRoute: static mismatch', () => {
  assert.equal(matchRoute('/invoices', '/orders'), false)
})

test('matchRoute: param segment matches any value', () => {
  assert.equal(matchRoute('/invoices/:id', '/invoices/INV-001'), true)
})

test('matchRoute: param segment matches numeric value', () => {
  assert.equal(matchRoute('/invoices/:id', '/invoices/42'), true)
})

test('matchRoute: too few segments', () => {
  assert.equal(matchRoute('/invoices/:id', '/invoices'), false)
})

test('matchRoute: too many segments', () => {
  assert.equal(matchRoute('/invoices/:id', '/invoices/42/extra'), false)
})

test('matchRoute: multiple params', () => {
  assert.equal(matchRoute('/orgs/:org/repos/:repo', '/orgs/acme/repos/api'), true)
})

test('matchRoute: multiple params — wrong static segment', () => {
  assert.equal(matchRoute('/orgs/:org/repos/:repo', '/orgs/acme/blobs/api'), false)
})

test('matchRoute: trailing slash ignored on empty filter', () => {
  // filter(Boolean) strips empty strings, so trailing slashes are ignored
  assert.equal(matchRoute('/invoices/:id', '/invoices/INV-001/'), true)
})

// ---------------------------------------------------------------------------
// suggestSelector — needs a minimal Element stub
// ---------------------------------------------------------------------------

/** Minimal Element stub: only implements the attributes and methods pill uses. */
function makeEl({ dataTour, id, ariaLabel, title, textContent, tagName } = {}) {
  const attrs = {}
  if (dataTour !== undefined) attrs['data-tour'] = dataTour
  if (ariaLabel !== undefined) attrs['aria-label'] = ariaLabel
  if (title !== undefined) attrs['title'] = title

  return {
    tagName: (tagName ?? 'div').toUpperCase(),
    id: id ?? '',
    textContent: textContent ?? '',
    getAttribute(name) { return attrs[name] ?? null },
  }
}

test('suggestSelector: uses existing data-tour attribute', () => {
  const el = makeEl({ dataTour: 'invoice-total' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="invoice-total"]')
  assert.equal(needsAttribute, false)
})

test('suggestSelector: falls back to id when no data-tour', () => {
  const el = makeEl({ id: 'InvoiceTotal' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="invoicetotal"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: id with spaces/hyphens slugified', () => {
  const el = makeEl({ id: 'invoice-total-amount' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="invoice-total-amount"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: falls back to aria-label when no id', () => {
  const el = makeEl({ ariaLabel: 'Invoice Total' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="invoice-total"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: falls back to title when no id or aria-label', () => {
  const el = makeEl({ title: 'Submit Button' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="submit-button"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: falls back to text content', () => {
  const el = makeEl({ textContent: 'View Invoice' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="view-invoice"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: falls back to tag name when no text', () => {
  const el = makeEl({ tagName: 'button' })
  const { selector, needsAttribute } = suggestSelector(el)
  assert.equal(selector, '[data-tour="button"]')
  assert.equal(needsAttribute, true)
})

test('suggestSelector: aria-label truncated at 40 chars', () => {
  const el = makeEl({ ariaLabel: 'A Very Long Label That Exceeds The Maximum Allowed Characters' })
  const { selector } = suggestSelector(el)
  const inner = selector.replace('[data-tour="', '').replace('"]', '')
  assert.ok(inner.length <= 40, `slug length ${inner.length} exceeds 40`)
})

test('suggestSelector: text content truncated at 40 chars', () => {
  const el = makeEl({ textContent: 'Some really long text content that is longer than forty chars' })
  const { selector } = suggestSelector(el)
  const inner = selector.replace('[data-tour="', '').replace('"]', '')
  assert.ok(inner.length <= 40, `slug length ${inner.length} exceeds 40`)
})

// ---------------------------------------------------------------------------
// pill/dist/pill.js exists and is an IIFE
// ---------------------------------------------------------------------------

test('pill/dist/pill.js exists', () => {
  const pillPath = join(root, 'pill', 'dist', 'pill.js')
  assert.ok(existsSync(pillPath), 'pill/dist/pill.js should exist after build')
})

test('pill/dist/pill.js is an IIFE (not an ES module)', () => {
  const pillPath = join(root, 'pill', 'dist', 'pill.js')
  const code = readFileSync(pillPath, 'utf8')
  assert.ok(!code.includes('export '), 'pill.js should not contain ES module exports')
  assert.ok(code.includes('(function()'), 'pill.js should be wrapped in an IIFE')
})

test('pill/dist/pill.js contains shadow DOM attachment', () => {
  const pillPath = join(root, 'pill', 'dist', 'pill.js')
  const code = readFileSync(pillPath, 'utf8')
  assert.ok(code.includes('attachShadow'), 'pill.js should use shadow DOM')
})

// ---------------------------------------------------------------------------
// nearestCorner — where the badge lands after a drag
// ---------------------------------------------------------------------------

test('nearestCorner: each quadrant snaps to its own corner', () => {
  const { nearestCorner } = pillModule
  assert.equal(nearestCorner(1800, 1000, 1920, 1080), 'bottom-right')
  assert.equal(nearestCorner(100, 1000, 1920, 1080), 'bottom-left')
  assert.equal(nearestCorner(1800, 40, 1920, 1080), 'top-right')
  assert.equal(nearestCorner(100, 40, 1920, 1080), 'top-left')
})

test('nearestCorner: the exact centre counts as bottom-right', () => {
  const { nearestCorner } = pillModule
  assert.equal(nearestCorner(960, 540, 1920, 1080), 'bottom-right')
})

test('tourValue reads the data-tour value out of a selector', () => {
  const { tourValue } = pillModule
  assert.equal(tourValue('[data-tour="invoice-total"]'), 'invoice-total')
  assert.equal(tourValue('.total'), undefined)
})
