# docugate

Command-line tools for [DocuGate](https://www.trydocugate.site), which publishes
documentation straight from the markdown in your GitHub repository and decides
who may read it.

```sh
npx docugate init     # set this repository up for DocuGate
npx docugate check    # check the docs the way DocuGate will read them
npx docugate openapi  # prepare an OpenAPI spec for the API reference
```

Works with npm, pnpm, yarn and bun. Requires Node 18.17 or later. Run every
command from the root of your repository.

## `init`

Creates a `docugate.json` and, if your docs folder has no markdown yet, a first
`index.md`. It never overwrites a file, so it is safe to run in a repository
that already has docs.

```sh
npx docugate init --dir docs --title "Acme API"
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
      - run: npx docugate check
```

## `openapi`

Takes the OpenAPI 3 spec your backend already produces and writes the version
you want published: only the public paths, without sensitive fields, with keys
in a stable order so it reviews cleanly in a pull request.

```sh
npx docugate openapi --from http://localhost:3000/openapi.json \
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

| Key | Meaning |
| --- | --- |
| `docsDir` | The folder DocuGate reads. Defaults to `docs`. |
| `title` | The space's title. |
| `sidebar` | File and folder names in the order the sidebar should show them. |
| `api.generate` | Defaults for `docugate openapi`. |

## Licence

MIT
