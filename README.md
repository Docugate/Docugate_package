# docugate

Command-line tools for [DocuGate](https://www.trydocugate.site), which publishes
documentation straight from the markdown in your GitHub repositories and decides
who may read it.

```sh
npm i -g docugate
```

```sh
docugate init     # set this repository up for DocuGate
docugate check    # check the docs the way DocuGate will read them
docugate openapi  # prepare an OpenAPI spec for the API reference
```

Installing the command once is usually simpler than reaching for a package
manager in each repository: it needs no `package.json`, so it works just as
well in a Go, Python or Flutter repository as in a JavaScript one. That matters
because one DocuGate space can read from several repositories, and they are
rarely all the same language.

If you would rather not install it globally, `npm i -D docugate` adds it to a
single Node project, which also pins the version for CI; `npx docugate` runs it
without installing anything. Both work with pnpm, yarn and bun too.

Requires Node 18.17 or later. Run every command from the root of your
repository.


## IBM Bob 2.0 hackathon

This repository is DocuGate's entry to the IBM Bob 2.0 hackathon (lablab.ai,
September 25 to 27, 2026). To be clear about what was built when:

* **Before the event:** the CLI above (`init`, `check`, `openapi`), moved here
  from DocuGate's private repository with its history.
* **During the event, with IBM Bob:** the UI tour: the `.docugate/tour/` format,
  `docugate tour`, tour checks in `docugate check`, the pill, and the Tour Writer
  mode. Screenshots of the Bob sessions are in `bob_sessions/`.

## Several repositories in one space

A space can merge the docs from a frontend, a backend and a mobile app into one
set of pages, so a feature that spans all three is documented once instead of
three times. Repositories are added to a space from its settings on
[trydocugate.site](https://www.trydocugate.site/dashboard), not from here.

What that changes for this package: run `init` and `check` in **each**
repository that contributes docs. Every one gets its own `docugate.json`, naming
its own docs folder. `check` reads the repository it is run in, which is why its
300-page limit is per repository rather than per space.

See [Merging repositories](https://www.trydocugate.site/docs/merging-repositories).

## `init`

Creates a `docugate.json` and, if your docs folder has no markdown yet, a first
`index.md`. It never overwrites a file, so it is safe to run in a repository
that already has docs.

```sh
docugate init --dir docs --title "Acme API"
```

Then push, and publish the space from your
[DocuGate dashboard](https://www.trydocugate.site/dashboard/new).

## `check`

Reads your docs folder with DocuGate's own rules and reports what the
published page would get wrong:

- **Errors:** broken links between pages, links that leave the docs folder,
  two files that become the same URL, an unreadable `docugate.json`, an empty
  docs folder, or more than 300 pages.
- **Warnings:** pages with no `# Title`, front matter, `.mdx` files, no landing
  page, and `sidebar` entries that match nothing.

It exits with 1 when there are errors (add `--strict` to fail on warnings too),
so it works as a CI step:

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
      - run: npx docugate@0.1 check
```

Pin the version in CI, as above, or add the package to the repository and run
it from there. Without a pin, the rules being enforced can change between two
runs of the same workflow, which turns a green build red with nothing in the
commit to explain it.

## `openapi`

Takes the OpenAPI 3 spec your backend already produces and writes the version
you want published: only the public paths, without sensitive fields, with keys
in a stable order so it reviews cleanly in a pull request.

```sh
docugate openapi --from http://localhost:3000/openapi.json \
  --exclude "/internal/**" --redact passwordHash --out openapi.json
```

- `--from`: a `.json`, `.yaml` or `.yml` file, or a URL serving one.
- `--include` / `--exclude`: path globs; `*` matches within one segment and
  `**` matches across segments. Both can be repeated.
- `--redact`: a property name to remove from every schema and example.
  Can be repeated.
- `--check`: don't write anything; exit with 1 if the committed file is out of
  date. Useful in CI.

Instead of passing flags every time, you can set the same options in
`docugate.json`:

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

The `openapi` command doesn't read your code to infer a spec. Frameworks that
already know their schemas can export one: NestJS (`@nestjs/swagger`), Fastify
(`@fastify/swagger`), FastAPI, and Hono (`@hono/zod-openapi`). Point `--from`
at that output.

DocuGate's API reference pages, which are built from this file, are coming
soon. See the
[changelog](https://www.trydocugate.site/resources/changelog).

## `docugate.json`

One per repository, at its root.

| Key | Meaning |
| --- | --- |
| `docsDir` | The folder DocuGate reads. Defaults to `docs`. |
| `title` | The space's title. |
| `sidebar` | File and folder names in the order the sidebar should show them. Orders this repository's own pages, not the whole space. |
| `api.generate` | Defaults for `docugate openapi`. |

## Licence

MIT
