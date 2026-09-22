import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type OpenApiOptions = {
  /** A spec file (.json, .yaml, .yml) or an http(s) URL serving one. */
  from: string
  /** Where to write the result, relative to the repository root. */
  output: string
  /** Path globs to keep. Empty keeps every path. */
  include: string[]
  /** Path globs to drop, applied after `include`. */
  exclude: string[]
  /** Property names removed from every schema and example. */
  redact: string[]
}

export type OpenApiResult = {
  spec: Record<string, unknown>
  text: string
  operations: number
  droppedPaths: string[]
  redacted: number
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

/**
 * `*` matches within one path segment and `**` across them, so
 * `/internal/**` drops everything under /internal and `/v1/*` keeps only
 * direct children of /v1.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      pattern += '.*'
      i++
    } else if (c === '*') {
      pattern += '[^/]*'
    } else {
      pattern += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`)
}

async function readSource(root: string, from: string): Promise<{ text: string; yaml: boolean }> {
  if (/^https?:\/\//i.test(from)) {
    const res = await fetch(from, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`${from} answered ${res.status}.`)
    const type = res.headers.get('content-type') ?? ''
    return { text: await res.text(), yaml: /ya?ml/i.test(type) || /\.ya?ml(\?|$)/i.test(from) }
  }
  const path = resolve(root, from)
  if (!existsSync(path)) throw new Error(`${from} does not exist.`)
  return { text: readFileSync(path, 'utf8'), yaml: /\.ya?ml$/i.test(from) }
}

/** Every `$ref` in the document, so external ones can be refused. */
function refsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) refsIn(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') out.push(v)
      else refsIn(v, out)
    }
  }
  return out
}

/**
 * Removes redacted property names from schemas (and their `required` lists)
 * and from examples. Returns how many were removed.
 */
function redact(value: unknown, names: Set<string>, inExample = false): number {
  if (!names.size || !value || typeof value !== 'object') return 0
  let removed = 0

  if (Array.isArray(value)) {
    for (const v of value) removed += redact(v, names, inExample)
    return removed
  }

  const obj = value as Record<string, unknown>

  if (inExample) {
    for (const key of Object.keys(obj)) {
      if (names.has(key)) {
        delete obj[key]
        removed++
      } else removed += redact(obj[key], names, true)
    }
    return removed
  }

  const props = obj.properties
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const key of Object.keys(props)) {
      if (names.has(key)) {
        delete (props as Record<string, unknown>)[key]
        removed++
      }
    }
    if (Array.isArray(obj.required)) obj.required = obj.required.filter((r) => !names.has(String(r)))
  }

  for (const [key, child] of Object.entries(obj)) {
    removed += redact(child, names, key === 'example' || key === 'examples')
  }
  return removed
}

/** Keys sorted at every level, so the same spec always writes the same bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  )
}

/**
 * Turns an existing OpenAPI 3 spec into the file DocuGate will read from the
 * repository: only the paths meant to be public, without redacted fields, in
 * a stable order so it diffs cleanly in review.
 *
 * It does not infer a spec from code. Frameworks that know their own schemas
 * (NestJS, Fastify, FastAPI, Hono with zod-openapi) already emit one; point
 * `from` at that file or at the URL the running server serves it on.
 */
export async function buildOpenApi(root: string, opts: OpenApiOptions): Promise<OpenApiResult> {
  const source = await readSource(root, opts.from)
  let doc: unknown
  try {
    doc = source.yaml ? parseYaml(source.text, { maxAliasCount: 100 }) : JSON.parse(source.text)
  } catch (error) {
    // A .json URL that actually serves YAML, or the other way round.
    try {
      doc = source.yaml ? JSON.parse(source.text) : parseYaml(source.text, { maxAliasCount: 100 })
    } catch {
      throw new Error(`${opts.from} is neither valid JSON nor YAML: ${(error as Error).message}`)
    }
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${opts.from} is not an OpenAPI document.`)
  }
  const spec = doc as Record<string, unknown>

  if (typeof spec.swagger === 'string') {
    throw new Error(
      `${opts.from} is Swagger ${spec.swagger}. DocuGate reads OpenAPI 3.0 and 3.1; convert it first, for example with swagger2openapi.`,
    )
  }
  if (typeof spec.openapi !== 'string' || !/^3\.[01]\./.test(spec.openapi)) {
    throw new Error(`${opts.from} has no "openapi": "3.x" field, so it is not an OpenAPI 3 document.`)
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error(`${opts.from} has no "paths".`)
  }

  const external = refsIn(spec).filter((ref) => !ref.startsWith('#/'))
  if (external.length) {
    throw new Error(
      `${opts.from} references other files (${[...new Set(external)].slice(0, 3).join(', ')}). ` +
        'Bundle it into one document first, for example with `npx @redocly/cli bundle`.',
    )
  }

  const include = opts.include.map(globToRegExp)
  const exclude = opts.exclude.map(globToRegExp)
  const paths = spec.paths as Record<string, Record<string, unknown>>
  const droppedPaths: string[] = []

  for (const path of Object.keys(paths)) {
    const kept =
      (!include.length || include.some((r) => r.test(path))) && !exclude.some((r) => r.test(path))
    if (!kept) {
      delete paths[path]
      droppedPaths.push(path)
    }
  }

  const redacted = redact(spec, new Set(opts.redact))

  let operations = 0
  for (const item of Object.values(paths)) {
    for (const method of Object.keys(item ?? {})) if (METHODS.has(method)) operations++
  }

  const text = JSON.stringify(sortKeys(spec), null, 2) + '\n'
  return { spec, text, operations, droppedPaths, redacted }
}

/** Whether the committed file already matches what would be written. */
export function isCurrent(root: string, output: string, text: string): boolean {
  const path = join(root, output)
  return existsSync(path) && readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === text
}

export function writeOpenApi(root: string, output: string, text: string): void {
  writeFileSync(join(root, output), text)
}
