import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { loadConfig } from './config.js'
import type { Issue } from './config.js'
import { MAX_FILES, firstHeading, landingPath, pathToSlug, resolveRelativeLink } from './rules.js'
import { loadTours } from './tour.js'

export type CheckResult = {
  docsDir: string
  pages: number
  errors: Issue[]
  warnings: Issue[]
}

/** Never part of a repository on GitHub, and huge when present locally. */
const SKIP = new Set(['node_modules', '.git'])

/** Every file under `dir`, as forward-slash paths relative to it. */
function walk(dir: string): string[] {
  const out: string[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  visit(dir)
  return out
}

/** Links in a page, skipping fenced code, where a link is only an example. */
function linksIn(content: string): string[] {
  const links: string[] = []
  let fenced = false
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const match of line.replace(/`[^`]*`/g, '').matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push(match[1])
    }
  }
  return links
}

/**
 * Checks a repository's docs the way DocuGate will read them, so problems turn
 * up on the command line or in CI rather than on the published page.
 *
 * Errors are things DocuGate will get wrong or refuse. Warnings are things it
 * handles, but probably not the way the author meant.
 */
export function check(root: string, dirOverride?: string): CheckResult {
  const loaded = loadConfig(root)
  const errors = [...loaded.errors]
  const warnings = [...loaded.warnings]
  const docsDir = (dirOverride ?? loaded.docsDir).replace(/^\/|\/$/g, '') || '.'
  const base = docsDir === '.' ? root : join(root, docsDir)

  if (!existsSync(base) || !statSync(base).isDirectory()) {
    errors.push({
      message: `The docs folder "${docsDir}" does not exist.${
        loaded.found ? '' : ' Set "docsDir" in docugate.json, or run `docugate init`.'
      }`,
    })
    return { docsDir, pages: 0, errors, warnings }
  }

  const files = walk(base)
  const pages = files.filter((f) => /\.md$/i.test(f))
  const shown = (p: string) => (docsDir === '.' ? p : `${docsDir}/${p}`)

  for (const f of files.filter((f) => /\.mdx$/i.test(f))) {
    warnings.push({ file: shown(f), message: 'is MDX, which DocuGate does not read. Rename it to .md.' })
  }

  if (pages.length === 0) {
    errors.push({ message: `There are no .md files in "${docsDir}", so the space would be empty.` })
    return { docsDir, pages: 0, errors, warnings }
  }
  if (pages.length > MAX_FILES) {
    errors.push({
      message: `"${docsDir}" has ${pages.length} markdown files. DocuGate refuses more than ${MAX_FILES}.`,
    })
  }

  // Two files that route to the same URL: only one of them can be reached.
  const bySlug = new Map<string, string[]>()
  for (const p of pages) bySlug.set(pathToSlug(p), [...(bySlug.get(pathToSlug(p)) ?? []), p])
  for (const [slug, clash] of bySlug) {
    if (clash.length > 1) {
      errors.push({
        message: `${clash.map(shown).join(' and ')} both become the page "/${slug}". Rename one.`,
      })
    }
  }

  const landing = landingPath(pages)
  if (!landing) {
    warnings.push({
      message: `"${docsDir}" has no index.md or README.md, so the space has no landing page.`,
    })
  }

  // Every slug a link could land on, with the README standing in as the index.
  const slugs = new Set(pages.map(pathToSlug))
  if (landing) slugs.add('')

  for (const page of pages) {
    const content = readFileSync(join(base, page), 'utf8').replace(/\r\n/g, '\n')

    if (content.startsWith('---\n')) {
      warnings.push({
        file: shown(page),
        message: 'starts with front matter, which DocuGate shows as text rather than reading.',
      })
    }
    if (!firstHeading(content)) {
      warnings.push({
        file: shown(page),
        message: 'has no "# Title" heading, so its title is made from the file name.',
      })
    }

    for (const href of linksIn(content)) {
      const target = resolveRelativeLink(href, page)
      if (target === null) continue
      if (target === '\0outside') {
        errors.push({
          file: shown(page),
          message: `links to ${href}, which is outside "${docsDir}" and will not be published.`,
        })
      } else if (!slugs.has(target)) {
        errors.push({ file: shown(page), message: `links to ${href}, which does not exist.` })
      }
    }
  }

  // Sidebar entries are file or folder names, matched at whatever level they
  // sit. One that matches nothing is almost always a rename it missed.
  const names = new Set(pages.flatMap((p) => p.split('/')))
  for (const entry of loaded.config.sidebar ?? []) {
    if (typeof entry === 'string' && !names.has(entry)) {
      warnings.push({
        file: 'docugate.json',
        message: `"sidebar" lists "${entry}", which is not a file or folder in "${docsDir}".`,
      })
    }
  }

  warnings.push(...checkTours(root))

  return { docsDir, pages: pages.length, errors, warnings }
}

/**
 * Turn a data-tour route path (with :param segments) into a regex that matches
 * the same path with any token in :param positions.
 *
 * The regex is intentionally loose so it matches template literals, Express
 * route strings, Hono route strings, etc.
 */
function routeToRegex(routePath: string): RegExp {
  // Split on :param segments, escape the literal parts, join with a wildcard
  const parts = routePath.split(/:[\w]+/)
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.join('[^/\'"` ]+'))
}

/** Extract bare path from a data field like `GET /api/invoices/:id → total`. */
function parseDataPath(data: string): string | null {
  const m = data.match(/\w+\s+(\/[^\s→]+)/)
  return m ? m[1].trim() : null
}

/** Resolve a single-level import path inside a source file. */
function resolveImport(from: string, spec: string, root: string): string | null {
  if (!spec.startsWith('.')) return null
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const base = join(root, dir, spec)
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '']) {
    const full = base + ext
    if (existsSync(full)) return full
    // index file
    const index = join(base, 'index') + ext
    if (existsSync(index)) return index
  }
  return null
}

/** All direct import specifiers found in a file. */
function importsIn(text: string): string[] {
  const specs: string[] = []
  for (const m of text.matchAll(/^import\s+[^'"]*['"]([^'"]+)['"]/gm)) specs.push(m[1])
  return specs
}

/**
 * Run tour checks against every tour file found under `.docugate/tour/`.
 * Issues are warnings: the docs still publish; the tour may just be wrong.
 */
function checkTours(root: string): Issue[] {
  const warnings: Issue[] = []
  let tours
  try {
    tours = loadTours(root)
  } catch (err) {
    warnings.push({ message: `tour: ${(err as Error).message}` })
    return warnings
  }
  if (tours.length === 0) return warnings

  for (const tour of tours) {
    const label = tour.file ?? `tour/${tour.route}`

    // required fields are validated by parseTourFile (throws); stops that
    // survive parsing already have target and code.

    // no two stops on a screen share a target
    const seen = new Map<string, string>()
    for (const stop of tour.stops) {
      const prev = seen.get(stop.target)
      if (prev) {
        warnings.push({
          file: label,
          message: `stops "${prev}" and "${stop.heading}" share the same target ${stop.target}.`,
        })
      } else {
        seen.set(stop.target, stop.heading)
      }
    }

    for (const stop of tour.stops) {
      const codeAbs = join(root, stop.code)

      // code file must exist
      if (!existsSync(codeAbs)) {
        warnings.push({ file: label, message: `stop "${stop.heading}": code file "${stop.code}" does not exist.` })
        continue
      }

      // source file must exist if given
      if (stop.source) {
        const sourceAbs = join(root, stop.source)
        if (!existsSync(sourceAbs)) {
          warnings.push({ file: label, message: `stop "${stop.heading}": source file "${stop.source}" does not exist.` })
        }
      }

      const codeText = readFileSync(codeAbs, 'utf8')

      // code file contains the data-tour value from target.
      // Accepts either the full attribute (data-tour="value") or the value as
      // any quoted string literal ("value" / 'value'), so that passing the
      // value through a prop like tour="invoice-status" also passes the check.
      // A renamed value (e.g. "invoice-total-RENAMED") must still warn.
      const tourValueMatch = stop.target.match(/data-tour=["']([^"']+)["']/)
      if (tourValueMatch) {
        const tourValue = tourValueMatch[1]
        const esc = tourValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const exactPattern = new RegExp(`["']${esc}["']`)
        if (!exactPattern.test(codeText)) {
          warnings.push({
            file: label,
            message: `stop "${stop.heading}": "${stop.code}" does not contain data-tour value "${tourValue}".`,
          })
        }
      }

      // code file (or a file it imports, one level deep) contains the endpoint path from data
      if (stop.data) {
        const endpointPath = parseDataPath(stop.data)
        if (endpointPath) {
          // build a regex that matches the path with :param as wildcard
          const pathRegex = routeToRegex(endpointPath)

          const filesForEndpoint: string[] = [codeAbs]
          for (const spec of importsIn(codeText)) {
            const resolved = resolveImport(stop.code, spec, root)
            if (resolved) filesForEndpoint.push(resolved)
          }

          const found = filesForEndpoint.some((f) => {
            try {
              const t = readFileSync(f, 'utf8')
              // Check for literal path or a path where :param is present as /:id etc.
              // We look for any substring matching the regex pattern by scanning lines
              return t.split('\n').some((line) => pathRegex.test(line))
            } catch {
              return false
            }
          })

          if (!found) {
            warnings.push({
              file: label,
              message: `stop "${stop.heading}": endpoint "${endpointPath}" not found in "${stop.code}" or its imports.`,
            })
          }
        }
      }
    }
  }

  return warnings
}
