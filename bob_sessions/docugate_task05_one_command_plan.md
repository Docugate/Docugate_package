# docugate init flow — implementation plan

## Overview

Three focused additions to the package:

1. **`src/tour-install.ts`** — a new module that finds the app's HTML/layout entry
   point and injects a dev-only pill loader script, marked with
   `<!-- docugate:pill -->` comment fences so it can be found and removed again.
   Exposed as `docugate tour install [--port n] [--remove]`.

2. **`src/init.ts` (extended)** — the existing `init` function is replaced with a
   richer interactive flow that asks one question at a time, saves `"role"` into
   `docugate.json`, conditionally runs `tourInit` + `tourInstall`, and prints a
   short summary.  The pure library function stays unit-testable; all I/O goes
   through an injectable `IO` interface so tests can drive it without a terminal.

3. **`src/tour-server.ts` (one-liner hint)** — when `docugate tour serve` starts
   and no pill snippet is found, print a one-line hint to run
   `docugate tour install`.

Tests live in `test/tour-install.test.mjs` and `test/init-flow.test.mjs`; they
use the same `repo()` / `fakeBob()` helpers as `test/tour-init.test.mjs`, no
external dependencies, no scratch files left in the repo root.

---

## Sub-task 1 — `src/tour-install.ts` + `docugate tour install`

### Intent
Give developers a single command that adds the DocuGate pill to their app without
touching anything unrelated to the injection point.  The snippet must be
idempotent (running twice is a no-op) and reversible (`--remove` takes it out).

### Expected outcomes
- `src/tour-install.ts` is a standalone TypeScript module exporting `tourInstall`
  and its types/errors.
- `docugate tour install` and `docugate tour install --remove` work end to end.
- `--port` defaults to `4178`; the generated URL is always
  `http://localhost:<port>/pill.js`.
- Running twice leaves the file identical to the first run.
- `--remove` on a file without the snippet is a silent no-op.
- When no HTML/layout is found the function returns `{ target: null }` and the
  CLI prints the one line to paste.

### Todo list

- [ ] Create `src/tour-install.ts` with exported types and `tourInstall` function.
  - Export `TourInstallOptions = { port?: number; remove?: boolean; root?: string }`
  - Export `TourInstallResult = { target: string | null; action: 'inserted' | 'removed' | 'already' | 'none' }`
  - **Pill snippet format** (HTML targets):
    ```
    <!-- docugate:pill -->
    <script>if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){var s=document.createElement('script');s.src='http://localhost:PORT/pill.js';document.head.appendChild(s)}</script>
    <!-- /docugate:pill -->
    ```
    Inserted immediately before `</body>`.
  - **Next.js snippet format** (layout/\_document targets):
    ```tsx
    {/* docugate:pill */}
    {process.env.NODE_ENV === 'development' && <script src="http://localhost:PORT/pill.js" />}
    {/* /docugate:pill */}
    ```
    Inserted before the closing `</body>` (or before the last `</html>` tag when
    `</body>` is absent in \_document).
  - **Discovery order** (stop at the first match, skip `node_modules/`, `dist/`,
    `build/`, `.next/`):
    1. `app/layout.tsx`, `app/layout.jsx`
    2. `src/app/layout.tsx`, `src/app/layout.jsx`
    3. `pages/_document.tsx`, `pages/_document.jsx`
    4. `index.html` (repo root)
    5. `frontend/index.html`, `client/index.html`, `web/index.html`,
       `app/index.html`, `public/index.html`
  - For discovery: check each candidate path with `existsSync`; return the first
    that exists.
  - For idempotence: search the file content for `<!-- docugate:pill -->` (HTML)
    or `{/* docugate:pill */}` (TSX/JSX).  If found and `remove` is false →
    return `{ action: 'already', target }`.  If found and `remove` is true →
    strip the block and return `{ action: 'removed', target }`.
  - For insert: splice the snippet in before `</body>` (HTML) or before
    `</body>` or `</html>` (TSX/JSX).  If neither tag is found → append to end
    of file (graceful fallback).
  - Never touch any content outside the comment fences.

- [ ] Register `tour install` in `src/cli.ts`:
  - Add `'role'` and `'remove'` to VALUE_FLAGS / bools respectively — actually:
    `role` is a value flag; `remove` and `yes` are booleans.
  - Add `install` as a recognized `sub` for `command === 'tour'`.
  - Add `'port'` already in VALUE_FLAGS (already present — no change needed).
  - Handler calls `tourInstall(root, { port, remove })` and prints result.
  - When `target === null` print the pill snippet line to paste.

### Relevant context
- Pattern for new modules: `src/init.ts`, `src/tour-init.ts`
- CLI sub-command registration: `src/cli.ts` lines 185–274
- Boolean/value flag parsing: `src/cli.ts` lines 66–92
- Idempotence marker convention: use HTML comments so the scanner is a plain
  `includes()` check, no regex required.

### Status
[ ] pending

---

## Sub-task 2 — extend `src/init.ts` with the interactive flow + `docugate init`

### Intent
Replace the plain `init(root, opts)` with a function that can optionally drive an
interactive wizard when a terminal is attached, while remaining fully testable
through an injected `IO` interface.  The wizard asks one short question, saves the
answer in `docugate.json`, then conditionally calls `tourInit` + `tourInstall`.

### Expected outcomes
- `docugate.json` gains a `"role"` field (`"frontend" | "backend" | "both"`).
- Running `docugate init` a second time skips every question that already has an
  answer in `docugate.json`.
- `--yes` accepts all defaults silently.
- In CI (no TTY: `process.stdin.isTTY === false`) the command writes
  `docugate.json` with a safe default role (`"both"`) and exits without asking.
- For `frontend` and `both` roles: offers to run `docugate tour init` (using the
  same Bob-injection pattern as today), then runs `docugate tour install`.
- For `backend` role: prints one explanatory line and skips both tour steps.
- Ends with a short bullet-list summary of what changed and the next command:
  `docugate tour serve`.
- A "sign-in" placeholder step is printed as a `[coming soon]` line (not
  interactive).
- The existing `docugate init --dir / --title` flags continue to work.
- `src/init.ts` pure function `init()` remains exported and unchanged so
  `test/cli.test.mjs` still passes as-is.

### Todo list

- [ ] Add `"role"` to `DocugateConfig` in `src/rules.ts` and `KNOWN_KEYS`.
- [ ] Define `IO` interface in `src/init.ts`:
  ```ts
  export interface IO {
    isTTY: boolean
    ask(question: string, defaultAnswer: string): Promise<string>
    print(line: string): void
  }
  ```
  The default implementation uses `node:readline` for `ask` and `console.log`
  for `print`.  Tests inject a fake `IO` that returns preset answers.
- [ ] Write `initFlow(root, options)` in `src/init.ts`:
  - `options`: `{ dir?, title?, role?, yes?: boolean, io?: IO, runBob?: RunBob }`
  - Calls existing `init(root, { dir, title })` first (idempotent).
  - Reads the saved config to check if `role` is already set.
  - If TTY is absent or `--yes` is set: use the `--role` flag value or `"both"` 
    as default without asking.
  - If TTY is present and `role` is not already saved: ask one question
    `"Is this repository the frontend, the backend, or both? [frontend/backend/both]"`.
  - Validates the answer against the three accepted values; re-prompts on invalid.
  - Saves `role` back to `docugate.json` (merge into existing JSON, preserve all
    other keys, pretty-print with 2 spaces).
  - Prints the sign-in placeholder line.
  - If role is `"frontend"` or `"both"`: offer to run tour init (skip with `--yes`
    in non-TTY; ask in TTY), then always run `tourInstall`.
  - If role is `"backend"`: print the skip message.
  - Print summary and `docugate tour serve` hint.
  - Return `InitFlowResult = { config: DocugateConfig; created: string[]; kept: string[]; tourResult?: TourInitResult; installResult?: TourInstallResult }`.
- [ ] Update the `case 'init':` handler in `src/cli.ts` to call `initFlow`
  instead of `init` when no `--dir`/`--title`-only invocation pattern would
  break anything.  Keep the existing short output for `--dir`/`--title` only
  invocations, or unify — prefer unify for simplicity.
  Add `role` to `VALUE_FLAGS` and `yes` to booleans in the parser.
- [ ] Update `HELP` string in `src/cli.ts` to document `--role` and `--yes`.

### Relevant context
- `src/init.ts` — existing `init()` to keep intact; write `initFlow` as additive.
- `src/rules.ts` lines 63–79 — `DocugateConfig` type and `KNOWN_KEYS`.
- `src/config.ts` — `loadConfig` for reading the current config.
- `src/tour-init.ts` — `tourInit` and its `RunBob` injection pattern.
- Sub-task 1's `tourInstall` function.
- `test/cli.test.mjs` test `'init creates config …'` — must still pass.
- Terminal I/O: use `node:readline` `createInterface` + `question()`.  Wrap in a
  `Promise` so the function is `async`.  Close the interface after each question.

### Status
[ ] pending

---

## Sub-task 3 — pill-missing hint in `docugate tour serve`

### Intent
When a developer has run `tour init` but not `tour install`, `tour serve` now
tells them what to do next rather than silently printing the manual paste
snippet.

### Expected outcomes
- When `docugate tour serve` starts and the server root has no file containing
  `<!-- docugate:pill -->` or `{/* docugate:pill */}`: print
  `Hint: run docugate tour install to add the pill to your app automatically.`
  immediately after the server URL line.
- When the snippet is already installed: no hint.

### Todo list

- [ ] Add a helper `hasPillSnippet(root: string): boolean` in
  `src/tour-install.ts` that searches the same candidate paths used by
  `tourInstall` and returns `true` if any of them contains the pill marker.
- [ ] In `src/cli.ts` `case 'serve':` block: after printing the screen count,
  call `hasPillSnippet(root)`; if false, print the hint.

### Relevant context
- `src/cli.ts` lines 240–259 — `case 'serve':` handler.
- Sub-task 1's candidate-path list.
- The pill marker strings: `<!-- docugate:pill -->` and `{/* docugate:pill */}`.

### Status
[ ] pending

---

## Sub-task 4 — tests: `test/tour-install.test.mjs`

### Intent
Cover every branch of `tourInstall` and `hasPillSnippet` with small, isolated
fixture projects so regressions are caught immediately.

### Expected outcomes
- All cases pass under `npm test`.
- No scratch files or plan files are left in the repo root.

### Todo list

- [ ] Create `test/tour-install.test.mjs` using `node:test` + `node:assert/strict`
  (same boilerplate as `test/tour-init.test.mjs`).
- [ ] Test: Vite project (`index.html` at root with `</body>`) — insert inserts
  the snippet before `</body>`, and the file contains the pill markers.
- [ ] Test: idempotence — running install twice leaves the file unchanged.
- [ ] Test: `--remove` strips the snippet; `--remove` on a clean file is a no-op.
- [ ] Test: Next.js app router (`app/layout.tsx`) — inserts the TSX snippet before
  `</body>`.
- [ ] Test: Next.js pages router (`pages/_document.tsx`) — inserts the TSX snippet.
- [ ] Test: nothing found — returns `{ target: null, action: 'none' }`.
- [ ] Test: `hasPillSnippet` returns true after install, false before.

### Relevant context
- `test/tour-init.test.mjs` — `repo()` helper and test structure.
- Sub-task 1's exported API.

### Status
[ ] pending

---

## Sub-task 5 — tests: `test/init-flow.test.mjs`

### Intent
Cover the interactive init wizard end-to-end with injected IO and injected Bob,
matching every described scenario.

### Expected outcomes
- All cases pass under `npm test`.
- Tests do not start a real terminal or call real Bob Shell.

### Todo list

- [ ] Create `test/init-flow.test.mjs` with the same `repo()` / `fakeBob()`
  pattern.
- [ ] Test: frontend role — `docugate.json` gains `"role": "frontend"`, tour init
  runs, tour install runs; summary lists changed files.
- [ ] Test: backend role — `docugate.json` gains `"role": "backend"`, tour init
  is skipped, tour install is skipped; summary says so.
- [ ] Test: both role — tour init runs and tour install runs.
- [ ] Test: second run skips the role question (role already in config).
- [ ] Test: `--yes` flag accepts defaults without asking.
- [ ] Test: non-TTY (CI) writes config and exits cleanly.
- [ ] Test: Vite fixture (with `index.html`) gets pill installed in frontend role.
- [ ] Test: Next app router fixture gets pill installed.
- [ ] Test: Next pages router fixture gets pill installed.
- [ ] Test: backend role prints the skip message.

### Relevant context
- `test/tour-init.test.mjs` — `fakeBob()` mock and `ok()` helper.
- Sub-task 2's `IO` interface — inject a fake `IO` object.
- Sub-task 1's `tourInstall` function.

### Status
[ ] pending

---

## Notes for implementation

- All new TypeScript files follow the conventions: strict mode, named exports,
  `.js` extensions in imports, no default exports.
- `node:readline` is a Node.js built-in — no new dependencies.
- `docugate.json` merge: `JSON.parse` existing content, spread, add `role`,
  `JSON.stringify(config, null, 2) + '\n'`. Never overwrite keys already there.
- The "sign-in coming soon" line is printed unconditionally at step (b); it is not
  interactive and does not gate any following step.
- `--yes` skips every interactive prompt; for tour-init it still calls Bob
  (that is what the user asked for).
- Candidate HTML paths are checked as absolute joins — `join(root, candidate)`.
- The pill snippet insertion is a plain string `replace` / `lastIndexOf` — no
  HTML parser needed.
- The TSX snippet uses `{/* … */}` JSX comments, not HTML comments.
- Tests use `mkdtempSync` for isolation; no cleanup needed (OS temp dir).
