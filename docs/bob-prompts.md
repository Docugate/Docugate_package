# Bob prompt pack

Five tasks for Bob IDE. Each one is a separate Bob task, so each gets its own
session summary.

## Before you start

- Bob IDE v2.0.2 or later. Older versions stop working on September 30.
- **Settings → General:** select the hackathon instance
  `ibm-coding-challenge-…` (region us-east), so Bobcoins come from the event
  account and not your own.
- You have **40 Bobcoins in total, with no top-ups.** Check usage in
  Settings → General after each task. To save them:
  - Start a **new task** for each prompt below. A long chat costs more as it
    grows.
  - Paste the whole prompt at once. Don't drip-feed follow-ups.
  - If Bob goes off track, stop it and re-prompt with the exact file and
    error, rather than asking it to "look around".
  - Use **Plan** mode only on tasks 3 and 4, where the design matters. Go
    straight to **Agent/Code** on the rest.
- Never paste an API key into Bob chat. Keys go in `.env` (ignored by git and
  by Bob) and in Vercel env vars.

## After each task: the session summary

1. In the Bob chat panel, select **Tasks**, then open the task (select
   **All** if it doesn't show).
2. Select the **task header**. The task session consumption summary appears.
3. Screenshot it as PNG into `bob_sessions/`, named
   `docugate_task01_demo_app_summary.png` (team name, task number, short
   description).
4. Commit and push.

---

## Task 1: demo app and a hand-written tour

> Create a small demo app in `examples/invoices/` using Vite and plain
> TypeScript, with no framework. It has three screens routed by
> `location.pathname`: `/invoices` (a table of invoices), `/invoices/:id`
> (one invoice with status, customer and total) and `/customers`. All data
> comes from `src/api.ts`, which uses `fetch` to call `GET /api/invoices`,
> `GET /api/invoices/:id` and `GET /api/customers`. In dev, a small Vite
> middleware plugin serves those from JSON fixtures in `fixtures/`. Put one
> screen per file in `src/screens/`. Add `data-tour="..."` attributes to the
> elements a new developer would ask about: the invoice table, the status
> badge, the total and the customer name.
>
> Then hand-write `examples/invoices/.docugate/tour/invoice-detail.md` in this
> exact format, with one `##` section per tagged element on that screen:
>
> ```md
> ---
> route: /invoices/:id
> title: Invoice detail
> ---
>
> ## Total
> target: [data-tour="invoice-total"]
> data: GET /api/invoices/:id → total
> code: src/screens/invoice-detail.ts
> docs: https://www.trydocugate.site/docs
>
> The amount due, tax included, exactly as the API returns it.
> ```
>
> Done when `npm install && npm run dev` in `examples/invoices` shows all
> three screens with data.

## Task 2: tour format, parser and checks

> Read `src/check.ts`, `src/config.ts`, `src/cli.ts` and `test/cli.test.mjs`
> first, and follow their style. The package is ESM TypeScript with no
> dependencies except `yaml`. Don't add others.
>
> 1. `src/tour.ts`: `parseTourFile(text, file)` reads the front matter
>    (`route`, `title`) and each `##` stop's `target`, `data`, `code` and `docs`
>    lines, plus the prose after them. `loadTours(dir)` reads every `.md` file
>    in `.docugate/tour/`. `matchRoute(route, pathname)` supports `:param`
>    segments.
> 2. Tour checks, run by `docugate check` when `.docugate/tour/` exists, and
>    reported through the existing `Issue` type as warnings:
>    - the `code` file exists
>    - the `code` file, or a file it imports (one level deep), contains the
>      endpoint path from `data` (treat `:id`-style segments as wildcards)
>    - the `code` file contains the `data-tour` value from `target`
>    - required fields are present, and no two stops on a screen share a
>      target
> 3. `docugate tour --export <file>` writes all screens and stops as one JSON
>    file, for the pill to load.
> 4. Tests in `test/tour.test.mjs` for parsing, route matching and each
>    check, using small fixture folders in `test/fixtures/`.
>
> Done when `npm test` passes, and running `docugate check` in
> `examples/invoices` passes, then warns after renaming `invoice-total` in the
> screen file.

## Task 3: the pill (use Plan mode first)

> Create `pill/` as a separate small package, `@docugate/pill`: one plain
> TypeScript file compiled to a single `pill.js` with no framework and no
> dependencies. Apps load it with one `<script>` tag with
> `data-tour-src="/tour.json"`. It renders inside a shadow DOM so the host
> app's CSS can't affect it.
>
> On load and on every URL change (patch `history.pushState` and listen for
> `popstate`), it finds the screen whose `route` matches `location.pathname`.
> If there is none, it draws nothing. Otherwise it shows a small pill in the
> bottom-right corner with two actions:
>
> - **Tour this page:** step through the stops. Dim the page, draw a ring
>   around each target and show a card with the title, prose, where the data
>   comes from (`data`), the code file (`code`) and a link to the docs, plus
>   Back, Next and Done buttons. Esc closes it.
> - **Explain:** while on, hovering any element that has a stop shows its
>   card beside it.
>
> Style: dark, system font, hairline borders, small and calm, like the
> Next.js dev indicator. Keyboard accessible, and respects
> `prefers-reduced-motion`.
>
> Wire it into `examples/invoices`: export the tour with
> `docugate tour --export public/tour.json` as part of the dev and build
> scripts, and add the script tag.
>
> Done when on `/invoices/1` the tour steps through every stop, and on a
> route with no tour the pill doesn't appear.

## Task 4: the AI tour generator with watsonx.ai (use Plan mode first)

> Add `src/generate.ts` to the package: `generateTour({ files, apiKey,
> projectId, url, model })` takes the app's source files (path and content)
> and returns tour files in the format `src/tour.ts` parses. It calls IBM
> watsonx.ai directly with `fetch`, not an SDK: first swap the API key for an
> IAM token at `https://iam.cloud.ibm.com/identity/token`, then call the
> watsonx.ai text chat endpoint with a Granite instruct model. Check the
> current endpoint, API version and model id against IBM's docs, and keep
> them in one place so they're easy to change.
>
> The prompt must teach the model the exact tour format, and tell it to only
> claim what it can see in the files: the real endpoint, the real component
> file, and a `data-tour` target that exists (or a suggested one, marked as
> such). After generating, run the tour checks from task 2 on the result.
> Keep only stops that pass, and return the failures in a separate list so the
> caller can show them.
>
> Then add a Vercel function to the demo, `examples/invoices/api/generate-tour.ts`,
> that reads `WATSONX_API_KEY`, `WATSONX_PROJECT_ID` and `WATSONX_URL` from the
> environment (never from the request), runs `generateTour` over the demo
> app's own `src/` files and returns the tours plus a pass/fail count. Add a
> **Generate tour with AI** button to the demo's `/customers` screen that
> calls it and shows the result.
>
> Keys come only from env vars. Don't log them, and never send them to the
> browser. Add unit tests for the parts that don't need the network
> (building the prompt, parsing the model's reply, filtering by the checks).
>
> Done when `npm test` passes and, with a real key in `.env`, the button
> returns generated tours with most stops passing.

## Task 5: docs

> Update `README.md` with a **Tours** section: what the tour is, the file
> format, `docugate check` for tours, `docugate tour --export`, how to add
> the pill, and how AI generation works (watsonx.ai, checked output, keys only
> on the server). Match the existing README's tone. Add a short
> `examples/invoices/README.md` explaining how to run the demo and deploy it
> to Vercel with the three env vars. No em dashes.
>
> Done when a new developer could run the demo from the README alone.
