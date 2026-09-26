# Tour Server Plan

## Overview

Add two new subcommands to `docugate tour`:
- `docugate tour serve [--port 4178]` — starts a local HTTP server that serves tour data from `.docugate/tour/` and emits live-reload SSE events when files change.
- `docugate tour export <file>` — writes every tour screen as a single JSON file for static demo hosting.

The server code goes in `src/tour-server.ts`. No new runtime dependencies. Everything inside `src/` must be framework-agnostic and must only read/write inside `.docugate/tour/` of the current working directory.

---

## Sub-Tasks

### Task 1 — Add `routeToFilename` helper to `src/tour.ts`

**Status:** [ ] pending

**Intent**
The naming convention for tour files (`/invoices/:id` → `invoices-id.md`, `/` → `home.md`) is currently documented only in the `TOUR_RULES` prose in `src/tour-init.ts`. Both the server's `PUT /stop` handler and the export command need to derive a filename from a route. Extract this as an exported function so the logic lives in one place.

**Expected Outcomes**
- `src/tour.ts` exports `routeToFilename(route: string): string`.
- `routeToFilename('/invoices/:id')` returns `'invoices-id.md'`.
- `routeToFilename('/')` returns `'home.md'`.
- `routeToFilename('/orgs/:org/repos/:repo')` returns `'orgs-org-repos-repo.md'`.

**Todo List**
1. Read the naming rule in `src/tour-init.ts` TOUR_RULES carefully (strip leading `/`, replace `/` and `:` with `-`, result is lowercase-slug + `.md`; special-case `/` → `home.md`).
2. Add `export function routeToFilename(route: string): string` to the bottom of `src/tour.ts`.
3. Add a few assertions to `test/tour.test.mjs` covering the examples above (import `routeToFilename` from `../dist/tour.js`).

**Relevant Context**
- `src/tour-init.ts` lines 25–26: `TOUR_RULES` naming convention.
- `src/tour.ts`: existing exports `parseTourFile`, `serializeTourFile`, `loadTours`, `matchRoute`.
- `test/tour.test.mjs` follows the pattern: import from `'../dist/tour.js'`, run assertions inline with `test(...)`.

---

### Task 2 — Create `src/tour-server.ts`

**Status:** [ ] pending

**Intent**
Implement the HTTP server that backs `docugate tour serve`. It must use only Node's built-in `http`, `fs`, and `path` modules (no new dependencies), listen only on `127.0.0.1`, and enforce a same-origin-ish restriction: only requests whose `Origin` or `Referer` header is a `localhost` origin are accepted (any port). All reads and writes are scoped to `<cwd>/.docugate/tour/`.

**Expected Outcomes**
- `src/tour-server.ts` exports a single function `startTourServer(root: string, port: number): Promise<{ port: number; close(): void }>`.
- The server responds:
  - **`GET /tour?path=<pathname>`** — finds the first tour whose route matches `pathname` (using `matchRoute`), returns `{ route, title, stops }` as JSON with `Content-Type: application/json`, or HTTP 404 with `{ error: "not found" }`.
  - **`GET /events`** — opens a server-sent events stream. Sets headers for SSE (`Content-Type: text/event-stream`, `Cache-Control: no-cache`). Uses `fs.watch` on the tour directory. When any file changes, emits `data: change\n\n`. Cleans up the watcher when the client disconnects.
  - **`PUT /stop`** — reads the JSON body (route + stop fields). Derives the filename via `routeToFilename`. If the file exists, parses it, finds the stop by `target` (update) or appends a new stop (create). If the file does not exist, creates a new `Tour` with that route and a derived `title` (title-case the last segment, or `"Home"` for `/`). Writes the result with `serializeTourFile`. Returns HTTP 200 with `{ ok: true }`.
  - **`GET /pill.js`** — resolves `pill/dist/pill.js` relative to `import.meta.url` (i.e., this package's own directory), serves it with `Content-Type: application/javascript`, or HTTP 404 with a plain-text message if the file doesn't exist yet.
  - All other paths → HTTP 404.
- **Security**: For every request, check the `Origin` header (or fall back to the `Referer` host). If the header is present but the host is not `localhost` or `127.0.0.1` (any port is fine), return HTTP 403. Requests with no origin/referer header (e.g., direct `curl` from localhost) are allowed.
- The server is created with `http.createServer` and calls `server.listen(port, '127.0.0.1', ...)`.
- No frameworks, no new `package.json` dependencies.

**Todo List**
1. Create `src/tour-server.ts`.
2. Import only from `node:http`, `node:fs`, `node:path`, `node:url`, `node:stream` and the project's own `./tour.js`.
3. Implement the origin-check helper: parse the `Origin` header; if absent, try `Referer`; allow if no header is present, allow if host is `localhost` or `127.0.0.1`; block otherwise with 403.
4. Implement `GET /tour` handler using `loadTours` + `matchRoute`.
5. Implement `GET /events` handler with `fs.watch`; emit `data: change\n\n` on file change; close watcher on client disconnect.
6. Implement `PUT /stop` handler: read body, derive filename with `routeToFilename`, load or create tour, upsert stop, write with `serializeTourFile`.
7. Implement `GET /pill.js` handler: resolve path relative to `import.meta.url` (go up one directory from `dist/`, then `pill/dist/pill.js`). Serve or 404.
8. Wire handlers in the main request dispatcher. Return 404 for anything else.
9. Export `startTourServer`.

**Relevant Context**
- `src/tour.ts`: `loadTours`, `matchRoute`, `parseTourFile`, `serializeTourFile`, `routeToFilename` (after Task 1).
- `Tour` and `TourStop` types are in `src/tour.ts`.
- File naming rule: `routeToFilename` from Task 1.
- `pill/dist/pill.js` does not exist yet (built in the next task per the user); `GET /pill.js` must 404 gracefully until it does.
- The server is only ever called from `src/cli.ts` with `root = process.cwd()`.

---

### Task 3 — Add `tour serve` and `tour export` to `src/cli.ts`

**Status:** [ ] pending

**Intent**
Wire the two new subcommands into the CLI's `tour` case. Update the `HELP` string and the arg parser.

**Expected Outcomes**
- `docugate tour serve [--port 4178]` calls `startTourServer(root, port)`, prints the startup message (URL, screen count, script tag), and stays alive until Ctrl-C. If `.docugate/tour/` does not exist, prints an error directing the user to run `docugate tour init` first and exits with code 2.
- `docugate tour export <file>` calls `loadTours(root)`, serialises every tour as an array of `{ route, title, stops }` objects, and writes the JSON to the given file. Prints the path and count.
- `--port` is a value flag (add to `VALUE_FLAGS` in the parser).
- `export` requires a positional file argument; if missing, fail with a clear message.
- The `tour` branch in `main()` handles `serve`, `export`, and `init`; unknown tour subcommands still error.

**Todo List**
1. Add `'port'` to `VALUE_FLAGS` in `src/cli.ts`.
2. Update `HELP` to document `tour serve` and `tour export`.
3. In the `tour` case: add `serve` and `export` branches alongside `init`.
4. For `serve`: check `.docugate/tour/` exists; if not, print error and `process.exit(2)`; otherwise call `startTourServer`, `await` it, print startup message, keep the process alive (the server holds the event loop open).
5. For `export`: read positional `<file>` (treat it as the next non-flag argument — adjust the `parse()` function to allow a second positional under `tour`); call `loadTours`, write JSON, print confirmation.
6. Import `startTourServer` from `./tour-server.js` and `writeFileSync` from `node:fs` in `src/cli.ts`.

**Relevant Context**
- `src/cli.ts` `parse()` function: already handles `sub` for the first word after `tour`; a second positional (the export filename) needs the parser extended or handled differently (e.g., treat it as a `flags` entry for `export-file`, or simply read `argv` directly in the `export` branch after the sub is known).
- Current `tour` case: only handles `init`; all other `sub` values call `fail`.
- `startTourServer` returns a `Promise<{ port, close }>` — `await` it to get the bound port for the startup message.

---

### Task 4 — Write `test/tour-server.test.mjs`

**Status:** [ ] pending

**Intent**
Provide a test suite that exercises all four HTTP endpoints and the CLI integration, using the existing fixtures and temporary copies for write operations. The server must bind to a random port (port 0) so tests never conflict.

**Expected Outcomes**
- `npm test` passes with no new failures.
- Tests cover:
  - `GET /tour?path=...` with a matching route → 200 + correct JSON.
  - `GET /tour?path=...` with no match → 404.
  - `GET /events` emits `data: change\n\n` when a `.md` file in the tour dir changes.
  - `PUT /stop` creates a new file when the screen doesn't exist.
  - `PUT /stop` updates an existing stop in a file that does.
  - `PUT /stop` adds a new stop to an existing file.
  - `GET /pill.js` → 404 when the file is absent.
  - Origin check: request with an allowed localhost origin → 200; request with a foreign origin → 403.
  - `docugate tour serve` CLI integration: prints startup message and URL; exits with code 2 when `.docugate/tour/` is absent.
  - `docugate tour export <file>` CLI integration: writes a JSON file with correct structure.
- Tests never read or write outside the repository (use `os.tmpdir()` for all write-heavy tests, same pattern as existing tests).
- The test file imports `startTourServer` from `../dist/tour-server.js`.

**Todo List**
1. Create `test/tour-server.test.mjs`.
2. Copy the `repo()` helper from `test/tour.test.mjs` (or import once it's in a shared place — for now, just inline it).
3. Write a `startServer(root)` helper that calls `startTourServer(root, 0)` (random port) and registers a cleanup with `after` or returns the `close` function.
4. For SSE: start the server, open an HTTP request to `/events`, write a file change, assert the `data: change` chunk arrives.
5. For write tests: make a temp copy of `test/fixtures/tour-check/` to avoid mutating the fixture.
6. For CLI tests: use `spawnSync` (same pattern as `test/tour-init.test.mjs`) against `dist/cli.js`.
7. Ensure all servers are closed after each test (no dangling handles).

**Relevant Context**
- Existing test patterns: `test/tour-init.test.mjs` uses `spawnSync` for CLI integration; `test/tour.test.mjs` uses the `repo()` helper + `mkdtempSync`.
- `test/fixtures/tour-check/` has `.docugate/tour/invoice-detail.md` with route `/invoices/:id` and two stops — good base fixture for read tests.
- Node's built-in test runner (`node:test`) is already in use; `after` / `afterEach` hooks are available.
- `startTourServer` binds to port 0 → the returned `port` is the actual OS-assigned port.

---

## Files Changed

| File | Action |
|------|--------|
| `src/tour.ts` | Add `routeToFilename` export |
| `src/tour-server.ts` | Create (HTTP server) |
| `src/cli.ts` | Add `serve` and `export` subcommands, `--port` flag |
| `test/tour-server.test.mjs` | Create (tests) |

No `package.json` changes. No new dependencies.
