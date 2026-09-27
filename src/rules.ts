/**
 * How DocuGate reads a repository, restated for the command line.
 *
 * These mirror src/lib/docs.ts and server/github.ts in the DocuGate app. They
 * are copied rather than imported because this package is published on its
 * own; if the app changes how it reads a repository, change them here too, or
 * `docugate check` will pass docs the server then renders differently.
 */

/** The server refuses a docs folder with more markdown files than this. */
export const MAX_FILES = 300

/** Turn `guides/deploying.md` into `guides/deploying`, and `index.md` into ''. */
export function pathToSlug(path: string): string {
  const withoutExt = path.replace(/\.md$/i, '')
  return withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/i, '')
}

/**
 * Resolve a relative markdown link, as authored inside `fromPath`, to the slug
 * DocuGate routes it under. Null for links this does not apply to: external
 * URLs, in-page anchors and anything that is not a markdown file.
 */
export function resolveRelativeLink(href: string, fromPath: string): string | null {
  if (!href || href.startsWith('#')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null

  const [rawPath] = href.split('#')
  if (!/\.mdx?$/i.test(rawPath)) return null

  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const segments = rawPath.startsWith('/') ? [] : dir.split('/').filter(Boolean)

  for (const part of rawPath.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // Climbing above the docs folder leaves it, and DocuGate only serves
      // what is inside it.
      if (!segments.length) return '\0outside'
      segments.pop()
    } else segments.push(part)
  }

  return pathToSlug(segments.join('/'))
}

/**
 * Where a docs folder has no index.md, its top-level README becomes the
 * landing page — the same file GitHub shows first.
 */
export function landingPath(paths: string[]): string | null {
  const index = paths.find((p) => pathToSlug(p) === '')
  if (index) return index
  return paths.find((p) => !p.includes('/') && /^readme\.md$/i.test(p)) ?? null
}

/** The page title DocuGate shows: the first `# heading`, if there is one. */
export function firstHeading(content: string): string | null {
  const heading = content.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : null
}

/** The fields docugate.json may carry, and what each must be. */
export type DocugateConfig = {
  docsDir?: string
  title?: string
  role?: 'frontend' | 'backend' | 'both'
  /** How often DocuGate checks the docs still match the code. */
  freshness?: 'push' | 'daily' | 'weekly' | 'off'
  /** The DocuGate space the docs publish to, as owner/slug. */
  space?: string
  sidebar?: string[]
  api?: {
    generate?: {
      from?: string
      output?: string
      include?: string[]
      exclude?: string[]
      redact?: string[]
    }
  }
}

export const KNOWN_KEYS = new Set(['$schema', 'docsDir', 'title', 'role', 'freshness', 'space', 'sidebar', 'api'])
