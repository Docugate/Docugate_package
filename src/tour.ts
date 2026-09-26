import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type TourStop = {
  /** Heading text for this stop (the ## heading). */
  heading: string
  /** CSS selector for the element, e.g. `[data-tour="invoice-total"]`. */
  target: string
  /** Request and field, e.g. `GET /api/invoices/:id → total`. Optional. */
  data?: string
  /** Repo-relative path to the file that renders the element. */
  code: string
  /** Repo-relative path to the file where the value is computed. Optional. */
  source?: string
  /** URL linking to relevant docs. Optional. */
  docs?: string
  /** Prose paragraph(s) after the fields. */
  prose: string
}

export type Tour = {
  /** URL pattern for the screen, e.g. `/invoices/:id`. */
  route: string
  /** Human-readable title for the screen. */
  title: string
  /** Stops, in order. */
  stops: TourStop[]
  /** Source file path, set by loadTours. */
  file?: string
}

/**
 * Parse a tour markdown file into a Tour object.
 * `text` is the file contents, `file` is the path (used for error messages).
 */
export function parseTourFile(text: string, file: string): Tour {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  // --- front matter ---
  let i = 0
  let route = ''
  let title = ''
  if (lines[0] === '---') {
    i = 1
    while (i < lines.length && lines[i] !== '---') {
      const m = lines[i].match(/^(\w+):\s*(.*)$/)
      if (m) {
        if (m[1] === 'route') route = m[2].trim()
        if (m[1] === 'title') title = m[2].trim()
      }
      i++
    }
    i++ // skip closing ---
  }

  if (!route) throw new Error(`${file}: missing "route" in front matter`)
  if (!title) throw new Error(`${file}: missing "title" in front matter`)

  const stops: TourStop[] = []

  while (i < lines.length) {
    // skip blank lines between stops
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break

    const headingMatch = lines[i].match(/^##\s+(.+)$/)
    if (!headingMatch) {
      i++
      continue
    }
    const heading = headingMatch[1].trim()
    i++

    // read key: value fields
    let target = ''
    let data: string | undefined
    let code = ''
    let source: string | undefined
    let docs: string | undefined

    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('##')) {
      const fm = lines[i].match(/^(\w+):\s*(.*)$/)
      if (fm) {
        switch (fm[1]) {
          case 'target': target = fm[2].trim(); break
          case 'data':   data   = fm[2].trim(); break
          case 'code':   code   = fm[2].trim(); break
          case 'source': source = fm[2].trim(); break
          case 'docs':   docs   = fm[2].trim(); break
        }
      }
      i++
    }

    if (!target) throw new Error(`${file}: stop "${heading}" missing "target"`)
    if (!code) throw new Error(`${file}: stop "${heading}" missing "code"`)

    // read prose (blank line, then text until next ## or end)
    while (i < lines.length && lines[i].trim() === '') i++
    const proseLines: string[] = []
    while (i < lines.length && !lines[i].startsWith('##')) {
      proseLines.push(lines[i])
      i++
    }
    // trim trailing blank lines
    while (proseLines.length > 0 && proseLines[proseLines.length - 1].trim() === '') {
      proseLines.pop()
    }

    stops.push({ heading, target, data, code, source, docs, prose: proseLines.join('\n') })
  }

  return { route, title, stops }
}

/**
 * Serialize a Tour back to the markdown format parseTourFile reads.
 */
export function serializeTourFile(tour: Tour): string {
  const lines: string[] = []
  lines.push('---')
  lines.push(`route: ${tour.route}`)
  lines.push(`title: ${tour.title}`)
  lines.push('---')

  for (const stop of tour.stops) {
    lines.push('')
    lines.push(`## ${stop.heading}`)
    lines.push(`target: ${stop.target}`)
    if (stop.data !== undefined) lines.push(`data: ${stop.data}`)
    lines.push(`code: ${stop.code}`)
    if (stop.source !== undefined) lines.push(`source: ${stop.source}`)
    if (stop.docs !== undefined) lines.push(`docs: ${stop.docs}`)
    if (stop.prose) {
      lines.push('')
      lines.push(stop.prose)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Read every .md file under `<root>/.docugate/tour/` and return an array of
 * Tour objects. Returns [] when the directory does not exist.
 */
export function loadTours(root: string): Tour[] {
  const dir = join(root, '.docugate', 'tour')
  if (!existsSync(dir)) return []
  const tours: Tour[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const file = join(dir, name)
    const text = readFileSync(file, 'utf8')
    const rel = `.docugate/tour/${name}`
    const tour = parseTourFile(text, rel)
    tour.file = rel
    tours.push(tour)
  }
  return tours
}

/**
 * Match a tour route pattern (with `:param` segments) against a pathname.
 * Returns true when they match.
 *
 * Examples:
 *   matchRoute('/invoices/:id', '/invoices/INV-001') → true
 *   matchRoute('/invoices/:id', '/invoices')         → false
 */
export function matchRoute(route: string, pathname: string): boolean {
  const routeParts = route.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (routeParts.length !== pathParts.length) return false
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) continue
    if (routeParts[i] !== pathParts[i]) return false
  }
  return true
}
