# Bob prompt pack

One prompt per step. For each one: open a **Plan** session, paste the prompt,
check the plan, then switch to **Agent** to build it. Screenshot the plan and
the finished Agent run into `docs/bob-sessions/` as `NN-step-plan.png` and
`NN-step-agent.png`. Judges ask for these.

Keep each run to its step. Credits are limited.

---

## 1. Demo app

> In `examples/invoices/`, create a small Vite app in plain TypeScript (no
> framework) with three screens routed by `location.pathname`: `/invoices`
> (a list), `/invoices/:id` (one invoice with a total), and `/customers`.
> Data comes from a fake API in `src/api.ts` with functions that `fetch`
> `GET /api/invoices`, `GET /api/invoices/:id` and `GET /api/customers`,
> served by a Vite dev middleware that returns JSON fixtures. Put a
> `data-tour="..."` attribute on the important elements of each screen
> (the list table, the total, the status badge, the customer name).
> Also write `.docugate/tour/invoice-detail.md` by hand in this format:
>
> ```md
> ---
> route: /invoices/:id
> ---
> # Invoice detail
>
> ## Total
> target: [data-tour="invoice-total"]
> data: GET /api/invoices/:id → total
> code: src/screens/invoice-detail.ts
> docs: https://www.trydocugate.site/docs/billing
>
> The amount due, tax included, as the API returns it.
> ```
>
> Done when `npm run dev` in `examples/invoices` shows all three screens.

## 2. Tour format and `docugate tour`

> Read `src/cli.ts`, `src/check.ts`, `src/config.ts` and `test/cli.test.mjs`
> to learn the patterns, then add:
>
> 1. `src/tour/format.ts`: parse `.docugate/tour/*.md` (front matter with the
>    `yaml` package, then one `##` section per stop with the `target`, `data`,
>    `code` and `docs` lines, then prose). Match routes with `:param`
>    segments to a real pathname.
> 2. `src/tour/serve.ts`: `docugate tour [--port 4178]` starts a Node `http`
>    server with CORS open to localhost. `GET /tour?path=/invoices/42` returns
>    the matching screen's stops as JSON, or 404. `GET /events` is an SSE
>    stream that sends `change` when any file in `.docugate/tour/` changes
>    (`fs.watch`). `GET /pill.js` serves the pill script.
> 3. A `tour` case in `src/cli.ts`, and help text for it.
> 4. Tests in `test/tour.test.mjs` for parsing and route matching.
>
> No new dependencies. Done when `npm test` passes and
> `curl "localhost:4178/tour?path=/invoices/42"` returns the stop from step 1.

## 3. The pill

> In `pill/pill.ts`, build one plain script (no framework) that `docugate
> tour` serves at `/pill.js` and apps load with a single `<script>` tag. It
> renders inside a shadow DOM so the host app's CSS can't reach it. On load it
> asks `http://localhost:4178/tour?path=<location.pathname>`. If the request
> fails or 404s, it draws nothing. Otherwise it shows a small pill bottom right
> with two actions:
> - **Tour this page:** step through the stops. Highlight each target with a
>   ring and a dimmed backdrop, and show a card with the title, prose,
>   `data`, `code` and a `docs` link, plus Back / Next / Done buttons.
> - **Explain UI:** while it's on, hovering any element with a stop shows its
>   card.
>
> It also listens on `/events` and reloads the stops on `change`, and
> re-requests the tour when the URL changes (patch `pushState` and listen for
> `popstate`). Dark UI, Geist-like system font, hairline borders. Add the script tag
> to `examples/invoices/index.html`. Done when the tour runs on
> `/invoices/42`, and the pill disappears once `docugate tour` is stopped.

## 4. Tour checks in `docugate check`

> Extend `docugate check` so that when `.docugate/tour/` exists, it
> verifies every stop against the code and reports through the existing
> `Issue` type as warnings:
> - the `code` file exists
> - the `code` file (or a file it imports, one level deep) contains the
>   endpoint path from `data` (turn `:id` into a wildcard)
> - the `code` file contains the `data-tour` value from `target`
>
> Keep the output style and exit codes `check` already uses. Add tests.
> Done when renaming `invoice-total` in the demo app makes `check` warn, and
> undoing the rename makes it pass.

## 5. The Tour Writer mode

> Create `.bob/custom_modes.yaml` with a `tour-writer` mode (name
> "🧭 Tour Writer", groups: read, and edit limited to
> `\.docugate/tour/.*\.md$`), plus rules in `.bob/rules-tour-writer/`
> that document the tour format from `src/tour/format.ts`. The mode's job:
> read an app's routes, screens, components and API calls, whatever the
> framework, and write one tour file per screen. Each stop gets
> `target`, `data`, `code`, `docs` and one line of prose. It never overwrites
> an existing tour file. It suggests `data-tour` attributes where there are
> none, and it finishes by running `docugate check`.

Then switch to the **Tour Writer** mode, with `examples/invoices` open, and
ask:

> Write the tour for every screen that doesn't have one yet.

Done when `invoices.md` and `customers.md` exist and `docugate check` passes.
**Time this run.** That's the "after" number in `docs/metrics.md`.

## 6. Static demo for the demo URL

> Add `docugate tour --export tour.json` that writes every screen's stops into
> one file, and let the pill read `window.DOCUGATE_TOUR` instead of the
> server when it's set. Build `examples/invoices` so it loads the exported
> JSON, with the fake API replaced by the same fixtures served statically.
> Done when `npm run build && npm run preview` shows the tour with no server
> running.
