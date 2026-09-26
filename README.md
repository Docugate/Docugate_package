# docugate

DocuGate publishes documentation straight from the markdown in your GitHub repositories and shows a walkthrough pill on your running app so any developer can see what each element on screen is and where its data comes from.

```sh
npm i -g docugate
```

---

## Quick start

`cd` into your app's repository, then run:

```sh
docugate init
```

It walks you through four steps:

1. **Repository role.** Say whether this repository is the frontend, the backend, or both.
2. **Sign in and connect.** Sign in to DocuGate with GitHub and connect this repository to a space.
3. **IBM Bob writes the tour.** Bob reads the code and writes one `.docugate/tour/*.md` file for each screen it finds.
4. **The pill is added to your app.** The dev-only loader snippet is inserted into your HTML or layout file.

Once that is done:

```sh
docugate tour serve
```

Start your app in another terminal, open it in the browser, and the pill appears in the corner.

---

## Tours

A tour helps a developer who is new to a codebase see what each element on screen is and where its data comes from. For each screen there is one markdown file in `.docugate/tour/`. Each file has front matter with a `route` and a `title`, then one `##` section per stop.

**Example stop:**

```markdown
---
route: /invoices/:id
title: Invoice detail
---

## Total
target: [data-tour="invoice-total"]
data: GET /api/invoices/:id → total
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://example.com/docs/billing

The amount due: the subtotal plus tax, computed by `totals()` in the backend.
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `target` | yes | CSS selector for the element. Prefer `[data-tour="…"]`. |
| `data` | no | Request and field: `METHOD /path → field`. |
| `code` | yes | File that renders the element, relative to the repository root. |
| `source` | no | File where the value is computed, when that is elsewhere. |
| `docs` | no | URL to relevant documentation. |

The prose paragraph after the fields explains what the element is and why its value is what it is.

Tour files are yours. `docugate tour init` never overwrites a file that already exists.

---

## The pill

When `docugate tour serve` is running, the pill appears in the corner of your app. It has two modes:

- **Walkthrough.** Steps through every stop on the current screen in order, highlighting each element and showing its tour card.
- **Inspector.** Hovering highlights an element; clicking it shows its stop: what it is and where its data comes from. An element with no stop yet offers **Add to tour**, a small form that saves the stop straight into the tour file, and tells you which `data-tour` attribute to add when the element has none.

The pill stays on every page while the server runs, including pages with no tour yet, so their first stop can be added from the browser. Edits to the tour files show up on the page as you save them.

`docugate tour install` adds the pill for you. It only loads when the app runs on `localhost` and the tour server answers, so it never shows in production.

---

## Keeping tours true

A tour is only useful while it is true, so `docugate check` verifies every claim in `.docugate/tour/` against the code. For each stop it warns when:

- the `code` file, or the `source` file, no longer exists;
- the `code` file, and the files it imports, no longer mention the endpoint in `data`;
- the `code` file no longer contains the `data-tour` value in `target` (a value passed through a prop counts);
- a required field is missing, or two stops on one screen point at the same element.

Rename `invoice-total` in a component and `check` tells you which stop went stale.

It checks your docs folder too:

- **Errors:** broken links between pages, links that leave the docs folder, two files that become the same URL, an unreadable `docugate.json`, an empty docs folder, or more than 300 pages.
- **Warnings:** pages with no `# Title`, front matter, `.mdx` files, no landing page, and `sidebar` entries that match nothing.

It exits with 1 when there are errors. Add `--strict` to fail on warnings too, which is how stale tour stops fail a build.

Use it in CI:

```yaml
# .github/workflows/docs.yml
name: Docs
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx docugate@0.2 check --strict
```

Pin the version in CI, as above. Without a pin, the rules being enforced can change between two runs of the same workflow, which turns a green build red with nothing in the commit to explain it.

---

## Commands

| Command | Main flags | What it does |
| --- | --- | --- |
| `docugate init` | `--dir`, `--title`, `--role frontend\|backend\|both`, `--yes` | Set up this repository for DocuGate (interactive). |
| `docugate check` | `--dir`, `--strict` | Check docs and tour files the way DocuGate will read them. |
| `docugate openapi` | `--from`, `--out`, `--include`, `--exclude`, `--redact`, `--check` | Prepare an OpenAPI spec for the API reference. |
| `docugate login` | | Sign in to DocuGate with GitHub. |
| `docugate logout` | | Sign out and delete saved credentials. |
| `docugate whoami` | | Print the currently signed-in user. |
| `docugate tour init` | `--max-cost <n>`, `--team-id <id>` | Write the first tour with IBM Bob (uses Bob Shell). |
| `docugate tour serve` | `--port <n>` (default 4178) | Start the local server that serves tour data for the pill. |
| `docugate tour install` | `--port <n>`, `--remove` | Add (or remove) the pill loader from your app's HTML or layout. |
| `docugate tour export <file>` | | Write every tour screen to a single JSON file. |

Run every command from the root of your repository.

---

## Try it on the demo

Clone [docugate-demo](https://github.com/Docugate/docugate-demo), a small full-stack app with a pre-written tour:

```sh
git clone https://github.com/Docugate/docugate-demo
cd docugate-demo

# install dependencies and start the app
npm install
npm run dev
```

In a second terminal:

```sh
cd docugate-demo
docugate tour serve
```

Open the app in the browser. The pill appears in the bottom-right corner.

---

## Several repositories in one space

A space can merge docs from a frontend, a backend, and a mobile app into one set of pages. `docugate init` connects the repository it runs in to one of your spaces once you are signed in; you can also add repositories from a space's settings on [trydocugate.site](https://www.trydocugate.site/dashboard).

Run `init` and `check` in each repository that contributes docs, and answer the role question in each: the tour lives in the frontend, and its `source` lines can point into the backend. Every one gets its own `docugate.json`, naming its own docs folder. `check` reads the repository it is run in, which is why its 300-page limit is per repository rather than per space.

See [Merging repositories](https://www.trydocugate.site/docs/merging-repositories).

---

## `openapi`

Takes the OpenAPI 3 spec your backend already produces and writes the version you want published: only the public paths, without sensitive fields, with keys in a stable order so it reviews cleanly in a pull request.

```sh
docugate openapi --from http://localhost:3000/openapi.json \
  --exclude "/internal/**" --redact passwordHash --out openapi.json
```

- `--from`: a `.json`, `.yaml` or `.yml` file, or a URL serving one.
- `--include` / `--exclude`: path globs; `*` matches within one segment and `**` matches across segments. Both can be repeated.
- `--redact`: a property name to remove from every schema and example. Can be repeated.
- `--check`: do not write anything; exit with 1 if the committed file is out of date. Useful in CI.

Instead of passing flags every time, set the same options in `docugate.json`:

```json
{
  "docsDir": "docs",
  "api": {
    "generate": {
      "from": "http://localhost:3000/openapi.json",
      "output": "openapi.json",
      "exclude": ["/internal/**"],
      "redact": ["passwordHash"]
    }
  }
}
```

---

## `docugate.json`

One per repository, at its root.

| Key | Meaning |
| --- | --- |
| `docsDir` | The folder DocuGate reads. Defaults to `docs`. |
| `title` | The space's title. |
| `role` | Repository role: `frontend`, `backend`, or `both`. Set by `docugate init`. |
| `sidebar` | File and folder names in the order the sidebar should show them. Orders this repository's own pages, not the whole space. |
| `api.generate` | Defaults for `docugate openapi`. |

---

## IBM Bob 2.0 hackathon

This repository is DocuGate's entry to the IBM Bob 2.0 hackathon (lablab.ai, September 25 to 27, 2026). To be clear about what was built when:

**Before the event:** the CLI that was already in DocuGate's private repository: `docugate init`, `docugate check`, and `docugate openapi`. Moved here with its history.

**During the event, with IBM Bob.** Each task has its session summary and export in `bob_sessions/`, and a plan where Bob planned first:

| Task | What Bob built |
| --- | --- |
| 01 | The first tour: Bob read the Ledgerly demo and wrote `.docugate/tour/invoice-detail.md`, tracing each value to its endpoint and backend file. |
| 02 | The tour format in code (`parseTourFile`, `serializeTourFile`, `loadTours`, `matchRoute`) and the tour checks in `docugate check`. |
| 03 | `docugate tour serve` (tour data, live change events, saving stops) and `docugate tour export`. |
| 04 | The pill: walkthrough, inspector and Add to tour, in a shadow DOM with no dependencies. |
| 05 | One command: `docugate init` walks through the whole setup, and `docugate tour install` adds the pill to the app. |
| 06 | `docugate login`, `logout` and `whoami`, and connecting the repository to a space during `init`. |
| 07 | This README. |

`docugate tour init` also runs IBM Bob itself, through Bob Shell. It installs a Tour Writer mode that may only edit `.docugate/tour/`, asks Bob to read the app's code, and never changes a tour file the user already has.

**During the event, without Bob:** the Ledgerly demo app; the website side of `docugate login` on trydocugate.site; and fixes found while testing, such as Windows short paths in `tour serve` and the sign-in link on Windows.

---

## Licence

MIT
