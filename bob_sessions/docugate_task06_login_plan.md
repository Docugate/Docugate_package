# DocuGate Task 06 — Login, Spaces, and Init Step-b

## Overview

Add `docugate login`, `docugate logout`, `docugate whoami`, a shared API helper, and wire up the "connect this repository" step inside `docugate init`. Everything is Node built-ins only; no new runtime dependencies.

The work splits into four independently deliverable sub-tasks, in order:

1. **src/auth.ts** — credentials store + browser-based OAuth flow
2. **src/api.ts** — fetch helper (bearer token, token renewal, error translation)
3. **CLI commands** — `login`, `logout`, `whoami` wired into `src/cli.ts`
4. **Init step-b** — fill in the "[coming soon]" placeholder in `src/init.ts`
5. **Tests** — `test/auth.test.mjs` and updated `test/init-flow.test.mjs`

---

## Sub-task 1 — src/auth.ts: credentials store and login flow

**Intent**  
Provide a single module that all other code imports to read, write, and clear saved credentials, and that implements the full browser-based OAuth loop for `docugate login`.

**Expected Outcomes**
- `~/.docugate/credentials.json` (mode `0600`) holds `{ token }` after a successful login.
- `loadCredentials()` returns `{ token }` or `null`.
- `saveCredentials(token)` writes the file atomically with mode `0600`.
- `clearCredentials()` deletes the file, silently if it does not exist.
- `login(baseUrl)` does the full browser-open / local-server / callback dance described in the spec and resolves with `{ token }`, or rejects after 5 minutes.

**Todo List**
- [ ] Create `src/auth.ts`.
- [ ] `credentialsPath()` → `path.join(os.homedir(), '.docugate', 'credentials.json')`.
- [ ] `loadCredentials()` reads and parses the file; returns `null` on any error.
- [ ] `saveCredentials(token)` → `mkdirSync` the directory, `writeFileSync` with mode `0o600`.
- [ ] `clearCredentials()` → `rmSync` with `{ force: true }`.
- [ ] `login(baseUrl, opts?)` function:
  - Generate 24 random bytes with `crypto.randomBytes`, encode as `base64url`.
  - Derive the display code: `state.slice(0, 8).toUpperCase()` formatted as `XXXX-XXXX`.
  - Start `http.createServer` on `127.0.0.1:0`; obtain the assigned port from `server.address()`.
  - Open the browser to `${baseUrl}/api/auth/cli?port=${port}&state=${state}` using `child_process.spawn` (`start` on Windows, `open` on macOS, `xdg-open` on Linux).
  - Print the URL and the code.
  - Set a 5-minute timeout that rejects and closes the server.
  - In the request handler: parse the query string, reject a wrong state with a 400, answer a correct callback with a small HTML "You can close this tab" page (200), resolve with the token, and close the server.
  - After resolution, call `saveCredentials(token)`.
- [ ] Export all four public symbols.

**Relevant Context**
- `src/tour-init.ts` uses `child_process.spawnSync`; `login` will use `spawn` (fire-and-forget for the browser opener).
- Node built-ins needed: `node:crypto`, `node:http`, `node:child_process`, `node:os`, `node:path`, `node:fs`, `node:url`.

**Status** `[ ] pending`

---

## Sub-task 2 — src/api.ts: fetch helper

**Intent**  
One small module wrapping `fetch` for all DocuGate API calls. Keeps auth concerns (bearer token, token renewal, error translation) in one place so `init.ts` and any future callers stay simple.

**Expected Outcomes**
- `apiFetch(path, opts?)` sends `Authorization: Bearer <token>`, where the token comes from `loadCredentials()`.
- If the response has an `x-docugate-token` header, `saveCredentials` is called with the new value.
- HTTP 401 throws an error with the text `"Run docugate login"`.
- A JSON body with an `error` field throws with a human-readable message; the mapping `pro_required_sources` → `"Connecting more than one repository to a space needs DocuGate Pro"` must be present.
- `getSession()` calls `GET /api/auth/session` and returns `{ user }` (or `{ user: null }` when 401).
- `getSpaces()` calls `GET /api/spaces/mine` and returns `{ spaces }`.
- `connectRepo(spaceId, repo, docsDir)` calls `POST /api/spaces/:id/sources`.
- The base URL is `process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'`.

**Todo List**
- [ ] Create `src/api.ts`.
- [ ] Define `BASE_URL` from env.
- [ ] `apiFetch(path, init?)` — load token, add Authorization header, call `fetch`, check for `x-docugate-token`, throw on 401 or error body.
- [ ] `getSession()`, `getSpaces()`, `connectRepo()` wrappers.
- [ ] Export all public symbols.

**Relevant Context**
- `fetch` is a global in Node ≥ 18 (which is the project's minimum, per `package.json`).
- `loadCredentials` / `saveCredentials` come from `src/auth.ts`.

**Status** `[ ] pending`

---

## Sub-task 3 — CLI commands: login, logout, whoami

**Intent**  
Expose the new auth module through three CLI commands, following the exact style of existing commands in `src/cli.ts`.

**Expected Outcomes**
- `docugate login` triggers the browser flow, prints `Signed in as @<githubLogin>` on success.
- `docugate logout` deletes `credentials.json`, prints `Signed out.`
- `docugate whoami` reads the saved token, calls `GET /api/auth/session`, prints `@<githubLogin>`, or says `Not signed in. Run docugate login.`
- All three appear in the help string.
- `--yes` passed to `login` is accepted (useful for the init-flow case; it changes nothing for the browser-open itself).
- `VALUE_FLAGS` is updated if the new commands need any value flags (they don't).

**Todo List**
- [ ] Add `login`, `logout`, `whoami` to the `HELP` constant in `src/cli.ts`.
- [ ] Add `case 'login'` in the `switch`, calling `login(BASE_URL)` from `src/auth.ts`, then `getSession()` from `src/api.ts`, printing the result.
- [ ] Add `case 'logout'` calling `clearCredentials()` from `src/auth.ts`.
- [ ] Add `case 'whoami'` calling `getSession()` and printing the login, or the "not signed in" message.
- [ ] Import `login`, `clearCredentials`, `loadCredentials` from `./auth.js` and `getSession` from `./api.js` at the top of `src/cli.ts`.
- [ ] Define `BASE_URL` in `src/cli.ts` from `process.env.DOCUGATE_URL ?? SITE`.

**Relevant Context**
- `SITE` is already defined as `'https://www.trydocugate.site'` in `src/cli.ts`.
- Existing error handling: `main().catch(...)` already prints and exits; individual cases call `fail()` for usage errors.

**Status** `[ ] pending`

---

## Sub-task 4 — Init step-b: fill in the sign-in + connect step

**Intent**  
Replace the single `[coming soon]` print in `initFlow` with a real interactive step that signs the user in (if needed) and then offers to connect the repository to one of their spaces.

**Expected Outcomes**
- If not signed in and `io.isTTY` is true: ask "Sign in to DocuGate now? [Y/n]". If yes (or `--yes`), call `login()`. Skip the whole step on non-TTY (CI).
- Once signed in (either pre-existing or just completed), call `getSpaces()`. If that throws (network, 401), print what went wrong and continue to step 4 without failing.
- If there are no spaces, print `Create a space first: https://www.trydocugate.site/dashboard/new` and continue.
- If there are spaces, print the list and ask which to connect, or "skip". Read `owner/name` from `git remote get-url origin` (via `child_process.execFileSync`, catch if git is absent). Read `docsDir` from `docugate.json` (already loaded). Call `connectRepo(spaceId, repo, docsDir)`. Print the result.
- If `connectRepo` fails (e.g. `pro_required_sources`), print the human-readable error and continue — never abort the whole init.
- `InitFlowOptions` gains optional injectable `connectFn` (type: same signature as `connectRepo`) and `getSpacesFn`/`getSessionFn` for testability — same injection pattern as `runBob`.
- The `InitFlowResult` gains optional `connectError?: string`.

**Todo List**
- [ ] Add `connectFn?`, `getSpacesFn?`, `getSessionFn?` to `InitFlowOptions`.
- [ ] Add `connectError?: string` to `InitFlowResult`.
- [ ] Replace the `[coming soon]` line in `initFlow` with the full step-b logic:
  - Check credentials with `loadCredentials()` (or injected `getSessionFn`).
  - If not signed in and TTY: ask to sign in (respect `yes`).
  - If signing in: call `login(BASE_URL)` wrapped in try/catch — on error, print and continue.
  - Load spaces (using injected `getSpacesFn` or real `getSpaces`), handle errors gracefully.
  - Present space choices, ask which to connect (or skip).
  - Call `connectRepo` (or injected `connectFn`), surface errors gracefully.
- [ ] Import `login`, `loadCredentials` from `./auth.js` and `getSpaces`, `connectRepo` from `./api.js`.
- [ ] Pass `BASE_URL` into the `login()` call; the base URL comes from `process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'` (define it in `init.ts` or accept as an option).

**Relevant Context**
- The injection pattern for `runBob` is the model: `options.runBob ?? defaultRunBob`.
- The step must never throw; all errors are caught, printed via `io.print(...)`, and execution continues.
- Git remote parsing: `execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', cwd: root })`. Extract `owner/name` from HTTPS or SSH remote URLs with a regex.

**Status** `[ ] pending`

---

## Sub-task 5 — Tests

**Intent**  
Cover the new code with automated tests that use no real network, no real browser, and a temp HOME directory. All tests must pass under `npm test`.

**Expected Outcomes**
- `test/auth.test.mjs` exists and tests:
  - `saveCredentials` / `loadCredentials` / `clearCredentials` round-trip with a temp HOME.
  - `login()` with a fake DocuGate server on a random port (started with `http.createServer`): verifies that the browser-open command is called, the callback URL is hit, a wrong state gets 400, a correct callback saves the token and the function resolves, and the 5-minute timeout path triggers a rejection.
  - `DOCUGATE_URL` env var is used as the base URL.
- `test/init-flow.test.mjs` is updated:
  - Remove the `'sign-in coming-soon line is always printed'` test (the placeholder is gone).
  - Add tests for:
    - Not signed in, TTY, user says yes → `connectFn` called with correct args.
    - Not signed in, TTY, user says no → `connectFn` not called.
    - Already signed in → skips the sign-in question, goes straight to spaces.
    - `getSpacesFn` throws → prints error, continues to tour steps.
    - No spaces → prints dashboard link, continues.
    - `connectFn` throws `pro_required_sources` error → prints human-readable message, continues.
    - `--yes` flag → signs in and connects without asking (uses first space).

**Todo List**
- [ ] Create `test/auth.test.mjs`.
  - Start a fake server for the OAuth callback test.
  - Set `DOCUGATE_URL` and a temp `HOME` before each relevant test.
  - Restore env vars after each test.
  - Intercept the browser-open subprocess call (pass a fake `openBrowser` option, or verify via the printed URL).
- [ ] Update `test/init-flow.test.mjs`:
  - Remove the coming-soon assertion.
  - Add the new sign-in / connect-space scenarios using `connectFn`, `getSpacesFn`, `getSessionFn` injection.

**Relevant Context**
- Test runner: `node --test` (built-in, no jest/mocha).
- Pattern for a temp HOME: set `process.env.HOME` (or `USERPROFILE` on Windows) to `mkdtempSync(...)` before the test, restore after.
- The fake DocuGate server pattern mirrors what `test/tour-server.test.mjs` does with a local HTTP server.
- The `fakeIO` helper in `init-flow.test.mjs` already models the injection pattern well.

**Status** `[ ] pending`

---

## Implementation Notes

- All new source files go in `src/`; compiled output lands in `dist/` via `tsc`.
- Import paths in `.ts` files use `.js` extensions (NodeNext module resolution — see existing imports in `src/cli.ts`).
- Test files import from `../dist/*.js` (compiled output), consistent with existing tests.
- The `BASE_URL` constant (`process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'`) needs to be accessible at module scope in both `src/api.ts` and `src/auth.ts`/`src/cli.ts`/`src/init.ts`. The cleanest approach is to define it in `src/api.ts` (exported) and import it elsewhere, or define it independently in each file as a one-liner.
- `login()` needs to be testable without a real browser. Accept an optional `openBrowser?: (url: string) => void` parameter that defaults to the platform-appropriate `child_process.spawn` call. Tests pass a no-op.
- The 5-minute timeout test can use a very short timeout via an injectable `timeoutMs` parameter.
