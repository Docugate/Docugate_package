import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../dist/check.js'
import { buildOpenApi, globToRegExp } from '../dist/openapi.js'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docugate-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })

test('init creates config and a first page, and never overwrites', () => {
  const dir = repo({})
  execFileSync(process.execPath, [CLI, 'init', '--title', 'Acme'], { cwd: dir })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'docugate.json'), 'utf8')), {
    docsDir: 'docs',
    title: 'Acme',
  })
  assert.ok(existsSync(join(dir, 'docs/index.md')))

  writeFileSync(join(dir, 'docs/index.md'), '# Mine\n')
  execFileSync(process.execPath, [CLI, 'init'], { cwd: dir })
  assert.equal(readFileSync(join(dir, 'docs/index.md'), 'utf8'), '# Mine\n')
})

test('check passes clean docs', () => {
  const dir = repo({
    'docugate.json': JSON.stringify({ docsDir: 'docs', sidebar: ['guides'] }),
    'docs/index.md': '# Home\n\nSee [setup](guides/setup.md#install).\n',
    'docs/guides/setup.md': '# Setup\n\nBack [home](../index.md).\n',
  })
  const result = check(dir)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.pages, 2)
  assert.equal(run(dir, 'check').status, 0)
})

test('check finds broken, escaping and code-fenced links correctly', () => {
  const dir = repo({
    'docs/README.md': '# Home\n\n[gone](missing.md) [out](../CONTRIBUTING.md) [ok](README.md)\n' +
      '```md\n[example](not-real.md)\n```\n`[inline](also-not-real.md)`\n',
  })
  const messages = check(dir).errors.map((e) => e.message)
  assert.equal(messages.length, 2)
  assert.match(messages[0], /missing\.md, which does not exist/)
  assert.match(messages[1], /outside "docs"/)
  assert.equal(run(dir, 'check').status, 1)
})

test('check reports clashing slugs, bad config and warnings', () => {
  const dir = repo({
    'docugate.json': '{ "docsDir": "docs", "sidebar": ["nope"], "colour": 1 }',
    'docs/guide.md': '---\ntitle: x\n---\nNo heading\n',
    'docs/guide/index.md': '# Guide\n',
    'docs/extra.mdx': '# MDX\n',
  })
  const result = check(dir)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].message, /both become the page "\/guide"/)
  const warnings = result.warnings.map((w) => w.message).join('\n')
  for (const expected of [/unknown key "colour"/, /front matter/, /no "# Title"/, /MDX/, /no index\.md/, /"nope"/]) {
    assert.match(warnings, expected)
  }
  assert.equal(run(dir, 'check', '--strict').status, 1)
})

test('check fails on invalid docugate.json and a missing folder', () => {
  const dir = repo({ 'docugate.json': '{ nope' })
  const result = check(dir)
  assert.match(result.errors[0].message, /not valid JSON/)
  assert.match(result.errors[1].message, /does not exist/)
})

test('globs match within and across segments', () => {
  assert.ok(globToRegExp('/v1/*').test('/v1/users'))
  assert.ok(!globToRegExp('/v1/*').test('/v1/users/{id}'))
  assert.ok(globToRegExp('/internal/**').test('/internal/a/b'))
  assert.ok(globToRegExp('/users/{id}').test('/users/{id}'))
})

const SPEC = `openapi: 3.0.3
info: { title: Pets, version: "1" }
paths:
  /pets:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
              example: { name: Rex, secret: s3 }
  /internal/health:
    get: { responses: { "200": { description: ok } } }
components:
  schemas:
    Pet:
      type: object
      required: [name, secret]
      properties:
        name: { type: string }
        secret: { type: string }
`

test('openapi filters paths, redacts fields and writes stable output', async () => {
  const dir = repo({ 'api.yaml': SPEC })
  const opts = { from: 'api.yaml', output: 'openapi.json', include: [], exclude: ['/internal/**'], redact: ['secret'] }
  const result = await buildOpenApi(dir, opts)
  assert.equal(result.operations, 1)
  assert.deepEqual(result.droppedPaths, ['/internal/health'])
  assert.equal(result.redacted, 2)
  const pet = result.spec.components.schemas.Pet
  assert.deepEqual(Object.keys(pet.properties), ['name'])
  assert.deepEqual(pet.required, ['name'])
  assert.equal((await buildOpenApi(dir, opts)).text, result.text)

  const args = ['openapi', '--from', 'api.yaml', '--exclude', '/internal/**', '--redact', 'secret']
  assert.equal(run(dir, ...args, '--check').status, 1)
  assert.equal(run(dir, ...args).status, 0)
  assert.equal(run(dir, ...args, '--check').status, 0)
})

test('openapi refuses Swagger 2, external refs and alias bombs', async () => {
  const opts = { output: 'o.json', include: [], exclude: [], redact: [] }
  const swagger = repo({ 's.json': '{"swagger":"2.0","paths":{}}' })
  await assert.rejects(buildOpenApi(swagger, { ...opts, from: 's.json' }), /Swagger 2\.0/)

  const external = repo({
    'e.json': JSON.stringify({ openapi: '3.1.0', paths: { '/a': { $ref: 'other.yaml#/a' } } }),
  })
  await assert.rejects(buildOpenApi(external, { ...opts, from: 'e.json' }), /references other files/)

  const bomb = ['a: &a [x, x, x, x, x, x, x, x, x, x]']
  for (let i = 0; i < 12; i++) bomb.push(`${'b' + i}: &b${i} [${Array(10).fill(i ? `*b${i - 1}` : '*a').join(', ')}]`)
  const bombDir = repo({ 'bomb.yaml': bomb.join('\n') + '\nopenapi: 3.0.0\npaths: {}\n' })
  await assert.rejects(buildOpenApi(bombDir, { ...opts, from: 'bomb.yaml' }))
})
