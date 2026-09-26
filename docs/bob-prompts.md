# Bob prompt pack

Six tasks for Bob IDE. Each one is a separate Bob task, so each gets its own
session summary.

## Before you start

- Bob IDE v2.0.2 or later. Older versions stop working on September 30.
- **Settings → General:** select the hackathon instance
  `ibm-coding-challenge-…` (region us-east), so Bobcoins come from the event
  account and not your own.
- You have **40 Bobcoins in total, with no top-ups.** Check usage in
  Settings → General after each task. To save them:
  - Start a **New Task** for each prompt below. A long chat costs more as it
    grows.
  - Paste the whole prompt at once. Don't drip-feed follow-ups.
  - If Bob goes off track, stop it and re-prompt with the exact file and
    error, rather than asking it to "look around".
  - Use **Plan** mode only on tasks 3 and 4, where the design matters. Go
    straight to **Agent** on the rest.
- Never paste an API key into Bob chat.

## After each task: the session summary

1. In the Bob chat panel, select **Tasks**, then open the task (select
   **All** if it doesn't show).
2. Select the **task header**. The task session consumption summary appears.
3. Screenshot it as PNG into `bob_sessions/`, named
   `docugate_task01_demo_app_summary.png` (team name, task number, short
   description).
4. Also export the task (the export icon in the Tasks panel) into
   `bob_sessions/`.
5. Commit and push.

---

## Task 1: the first tour, written by Bob from the demo's code

The demo app is **Ledgerly**, a small billing app in its own repo
([Docugate/docugate-demo](https://github.com/Docugate/docugate-demo)), with a
React `frontend/` and a Hono `backend/`. Clone it next to this repo
(`Documents/GitHub/docugate-demo`) and **open the demo in Bob for this task
only.** Tasks 2 to 6 run in this repo.

> Read this codebase: `frontend/src/` (screens, `api.ts`) and `backend/src/`
> (routes and `billing.ts`). Write `.docugate/tour/invoice-detail.md` at the
> repo root: a tour of the `/invoices/:id` screen for a developer who is new to
> the codebase. Add one stop for each element with a `data-tour` attribute on
> that screen. For each stop, trace where the value really comes from: the
> endpoint and field the frontend reads, and the backend file where the value
> is computed. Use exactly this format, with paths relative to the repo root:
>
> ```md
> ---
> route: /invoices/:id
> title: Invoice
> ---
>
> ## Total
> target: [data-tour="invoice-total"]
> data: GET /api/invoices/:id → total
> code: frontend/src/screens/InvoiceDetail.tsx
> source: backend/src/billing.ts
> docs: https://www.trydocugate.site/docs
>
> The amount due: the line items' subtotal plus 18% tax, computed by
> `totals()` in the backend. It is never stored.
> ```
>
> Only claim what the code shows. Keep the prose to one or two sentences
> per stop. Don't change any other file.
>
> Done when every `data-tour` element on the invoice screen has a stop, and
> each stop's `code` and `source` files exist.

## Task 2: tour format, parser and checks

> Read `src/check.ts`, `src/config.ts`, `src/cli.ts` and `test/cli.test.mjs`
> first, and follow their style. The package is ESM TypeScript with no
> dependencies except `yaml`. Don't add others.
>
> 1. `src/tour.ts`: `parseTourFile(text, file)` reads the front matter
>    (`route`, `title`) and each `##` stop's `target`, `data`, `code`,
>    `source` (optional: the file where the value is computed) and `docs`
>    lines, plus the prose after them. Use
>    `../docugate-demo/.docugate/tour/invoice-detail.md` (written in task 1)
>    as the reference example. `serializeTourFile(tour)` writes the
>    same format back, keeping the prose. `loadTours(dir)` reads every `.md`
>    file in `.docugate/tour/`. `matchRoute(route, pathname)` supports
>    `:param` segments.
> 2. Tour checks, run by `docugate check` when `.docugate/tour/` exists, and
>    reported through the existing `Issue` type as warnings:
>    - the `code` file exists, and so does `source` when given
>    - the `code` file, or a file it imports (one level deep), contains the
>      endpoint path from `data` (treat `:id`-style segments as wildcards)
>    - the `code` file contains the `data-tour` value from `target`
>    - required fields are present, and no two stops on a screen share a
>      target
> 3. Tests in `test/tour.test.mjs` for parsing, round-tripping, route matching
>    and each check, using small fixture folders in `test/fixtures/`.
>
> Done when `npm test` passes, and running `docugate check` in
> `../docugate-demo` passes, then warns after renaming `invoice-total` in
> `frontend/src/screens/InvoiceDetail.tsx`.

## Task 3: `docugate tour`, the local server (use Plan mode first)

> Add a `tour` command to `src/cli.ts`, backed by `src/tour-server.ts`.
> `docugate tour [--port 4178]` starts a Node `http` server (no framework)
> that only listens on `127.0.0.1`, only accepts requests from localhost
> origins, and only reads and writes inside `.docugate/tour/`:
>
> - `GET /tour?path=/invoices/inv_1004`: the matching screen and its stops as
>   JSON, or 404.
> - `GET /events`: server-sent events. Send `change` whenever a file in
>   `.docugate/tour/` changes (`fs.watch`), so the pill updates live.
> - `PUT /stop`: create or update one stop on a screen (screen route plus the
>   stop's fields). Create the screen file if it doesn't exist. Write with
>   `serializeTourFile`, change only that stop, and keep everything else in
>   the file exactly as it was.
> - `GET /pill.js`: serves the pill script from task 4.
>
> Also add `docugate tour --export <file>`, which writes every screen as one
> JSON file. This is only for a static demo build.
>
> Test the endpoints with the server on a random port. Done when `npm test`
> passes and `curl "localhost:4178/tour?path=/invoices/inv_1004"`, run while
> `docugate tour` runs in `../docugate-demo`, returns the stops from task 1.

## Task 4: the pill and the inspector (use Plan mode first)

> Create `pill/` as a separate small package, `@docugate/pill`: one plain
> TypeScript file compiled to a single `pill.js` with no framework and no
> dependencies. Apps add one script tag,
> `<script src="http://localhost:4178/pill.js"></script>`. It renders inside
> a shadow DOM so the host app's CSS can't affect it. If
> `window.DOCUGATE_TOUR` is set, it reads tours from there instead of the
> server. That's for the static demo only.
>
> If the local server doesn't answer, it draws nothing, so it never shows in
> production. When it answers, it shows a small inactive pill in the
> bottom-right corner, like the Next.js dev indicator. Clicking it opens two
> modes:
>
> - **Walkthrough:** steps through the current screen's stops. It dims the
>   page, draws a ring around each target and shows a card with the title,
>   prose, where the data comes from (`data`), the code file (`code`) and a
>   docs link, plus Back, Next and Done. It closes itself after the last stop.
>   Esc closes it too.
> - **Inspector:** while on, hovering an element highlights it. Clicking an
>   element with a stop shows a popup explaining what it does and where its
>   information comes from, with an **Edit** button. Clicking an element with
>   no stop offers **Add to tour**, which opens a small form (title, data,
>   code, docs, description) prefilled with a suggested `data-tour` selector.
>   Saving sends `PUT /stop`. Warn in the form if the element has no
>   `data-tour` attribute yet, and show the attribute to add.
>
> It re-reads the tour on URL changes (patch `history.pushState` and listen for
> `popstate`) and on the server's `change` events. Style: dark, system font,
> hairline borders, small and calm. Keyboard accessible, and respects
> `prefers-reduced-motion`. Add the script tag to
> `../docugate-demo/frontend/index.html`, and show `source` on the card
> when a stop has one.
>
> Done when the walkthrough runs on `/invoices/inv_1004` and closes at the end, the
> inspector explains the total, adding a stop on `/customers` creates
> `.docugate/tour/customers.md`, and the pill is gone when the server is
> stopped.

## Task 5: `docugate tour scan` (the client for DocuGate's AI)

> Add `docugate tour scan`. It never calls an AI provider directly, and it
> never holds a provider key. It sends the app's code to DocuGate's hosted
> API, which does the generation:
>
> 1. Collect the files that describe screens and data: routes, pages or
>    screens, components, and API or fetch calls. Respect `.gitignore`, skip
>    `node_modules`, build output and anything that looks like secrets
>    (`.env*`, keys, credentials), and cap the total size.
> 2. `POST` them to `${DOCUGATE_API_URL:-https://www.trydocugate.site}/api/tour/generate`
>    with `Authorization: Bearer $DOCUGATE_TOKEN`, along with the routes that
>    already have a tour file.
> 3. The response is a list of tour files. Write only files that don't exist
>    yet, and never overwrite the user's files. Then run the tour checks and
>    print what was added and what failed.
>
> Add `--dry-run`, which prints what it would send and write without calling
> the API, and clear errors for a missing token, 401 and 429. Put the request
> and response types in `src/tour-api.ts` so the server side can match them.
> Add tests with a fake server.
>
> Done when `docugate tour scan --dry-run` in `../docugate-demo` lists the
> right files and no secrets.

## Task 6: docs

> Update `README.md` with a **Tours** section: what the tour is (a way to help
> new developers understand an unfamiliar codebase faster), the file format,
> `docugate tour`, the walkthrough and inspector, `docugate check` for tours,
> and `docugate tour scan` (AI generation runs on DocuGate's hosted service,
> so no keys are needed locally). Link the demo app,
> https://github.com/Docugate/docugate-demo. Match the existing README's tone.
> No em dashes.
>
> Done when a new developer could run the demo from the README alone.
