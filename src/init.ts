import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CONFIG_FILE, loadConfig } from './config.js'

export type InitResult = { created: string[]; kept: string[]; docsDir: string }

/**
 * Sets a repository up for DocuGate: a docugate.json, and a first page if the
 * docs folder has none. Never overwrites — running it twice is harmless, and
 * running it in a repository that already has docs only adds what is missing.
 */
export function init(root: string, opts: { dir?: string; title?: string } = {}): InitResult {
  const created: string[] = []
  const kept: string[] = []
  const existing = loadConfig(root)
  const docsDir = (opts.dir ?? existing.docsDir).replace(/^\/|\/$/g, '') || 'docs'
  const title = opts.title ?? basename(root)

  if (existing.found) {
    kept.push(CONFIG_FILE)
  } else {
    const config = { docsDir, title }
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n')
    created.push(CONFIG_FILE)
  }

  const base = join(root, docsDir)
  const hasMarkdown =
    existsSync(base) && readdirSync(base, { recursive: true }).some((f) => /\.md$/i.test(String(f)))

  if (hasMarkdown) {
    kept.push(`${docsDir}/`)
  } else {
    mkdirSync(base, { recursive: true })
    writeFileSync(
      join(base, 'index.md'),
      `# ${title}\n\nWelcome. This page is the landing page of your DocuGate space.\n\n` +
        `Every \`.md\` file in \`${docsDir}/\` becomes a page, and every folder becomes a\n` +
        `section in the sidebar. The first \`# heading\` in a file is its title.\n`,
    )
    created.push(`${docsDir}/index.md`)
  }

  return { created, kept, docsDir }
}
