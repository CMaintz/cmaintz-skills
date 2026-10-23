# census.mjs

A deterministic inventory of a repo, the factual starting point for the codemap skill.
Node 22, no dependencies, reads only, prints JSON to stdout.

```bash
node plugins/foundry/scripts/codemap/census.mjs [--since "12 months ago"] [--threshold 0.5] [--min-shared 3]
```

Run it anywhere inside a git work tree; it inventories the whole tree from the top level.
A flag takes its value as the next argument or after `=`; a missing or non-numeric value
exits 2 with the reason on stderr.
Files come from `git ls-files --cached --others --exclude-standard`, so gitignored paths
(`node_modules`, `bin`, `obj`) never appear. Vendored code is left out of every field too:
files marked `linguist-vendored` in `.gitattributes`, and anything under a `vendor/` or
`third_party/` directory. Every path is repo-relative and uses `/`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--since` | `12 months ago` | History window for `churn`, `coChange` and the slice merge. Any `git log --since` value. |
| `--threshold` | `0.5` | Minimum coupling degree for a `coChange` pair and for merging slices (each measures degree differently, see below). |
| `--min-shared` | `3` | Minimum shared commits for the same. |

## Output shape

```jsonc
{
  // Build manifests: package.json, *.csproj, *.sln, pom.xml, build.gradle(.kts),
  // composer.json, pyproject.toml. Sorted.
  "manifests": ["package.json", "src/Api/Api.csproj"],

  // Sorted by path, then line.
  "entrypoints": [
    // kind: "http-route" | "bin" | "program" | "hosted-service".
    // method and route are set on http-route; symbol names a bin, class, action or handler.
    // line is set when the entry comes from a match inside a file.
    { "kind": "http-route", "path": "src/server.ts", "line": 2, "method": "GET", "route": "/health" },
    { "kind": "http-route", "path": "src/Api/Controllers/UsersController.cs", "line": 5,
      "method": "GET", "route": "/api/Users/{id}", "symbol": "GetById" },
    { "kind": "hosted-service", "path": "src/Api/Worker.cs", "line": 1, "symbol": "Worker" },
    { "kind": "program", "path": "src/Api/Program.cs", "symbol": "Program" },
    // path is the bin script itself, resolved against its package.json.
    { "kind": "bin", "path": "bin/cli.js", "symbol": "webctl" }
  ],

  // *.sql, schema.prisma, and anything under a migrations/ or Migrations/ directory. Sorted.
  "schemas": ["db/Migrations/20260101_Init.cs", "prisma/schema.prisma"],

  // Names from .env.example, process.env.X / process.env['X'], and
  // Environment.GetEnvironmentVariable("X"), with the files that mention each. Sorted by name.
  "envVars": [{ "name": "PORT", "files": [".env.example", "src/server.ts"] }],

  // Non-merge commits per file inside --since, for files that still exist.
  // Sorted by commits descending, then path.
  "churn": [{ "path": "src/server.ts", "commits": 14 }],

  // File pairs with shared >= --min-shared and degree >= --threshold, where degree is
  // shared / the commits of the less-changed file. Commits touching more than 50 files
  // are skipped as sweeps. Sorted by shared descending.
  "coChange": [{ "a": "src/billing/b.ts", "b": "src/orders/o.ts", "shared": 4, "degree": 1 }],

  // A proposal, built in four steps (rules below). name is the slice keys joined with "+",
  // so it is unique across slices. Sorted by files descending, then name.
  "slicePlan": [
    { "name": "src/billing+src/orders", "paths": ["src/billing", "src/orders"], "files": 2 },
    { "name": "users", "paths": ["src/Application/Users", "src/Domain/Users"], "files": 2 }
  ],

  // Files in no slice, grouped by directory. reason: "tests" (a test/, tests/, testing/,
  // __tests__/ or *.Tests/ directory, any case, at any depth), "config" (a dot-directory), "docs" and "infra"
  // (top-level docs/ or infra/, deploy/, terraform/, helm/ and the like), or "other" (outside
  // every source root). Root-level files are not listed. Sorted by path.
  "unsliced": [{ "path": "docs", "reason": "docs", "files": 3 }]
}
```

The slice plan is a starting point for the codemap skill's phase 1, not a final answer:

1. **Exclude.** Files that `unsliced` would list are set aside first, so a fixture tree
   like `tests/fixtures/src` never reads as source.
2. **Key each file.** Each top-level directory is descended while it holds only one other
   directory. From there, a chain of directly nested source roots (`src`, `app`, `apps`,
   `lib`, `packages`, `services`) is followed, and a file keys on the level below the last
   one: `backend/src/Api/x.cs` keys on `backend/src/Api`, `frontend/src/app/core/a.ts` on
   `frontend/src/app/core`. Files directly in a root key on the root (a flat `src/`). Only a
   chain counts, so a `lib/` inside `scripts/` stays part of that unit. Without a chain, a
   descended directory acts as a root (`plugins/foundry/skills`); an undescended one is its
   own slice, unless roots elsewhere in the repo show where the code lives, in which case
   it is `unsliced` as `other`. A directory with a root keeps its non-root files out too.
3. **Regroup by repeated names.** A subdirectory name found directly under two or more keys
   (case-insensitive) becomes one slice named after it, joined by any key whose last segment
   matches. This turns a layered layout (Api, Application, Domain) into domain slices.
   Generic names (`common`, `shared`, `utils`, `models`, `core`, ...) never regroup.
4. **Merge.** Slices merge when they share at least `--min-shared` commits and the shared
   count over the commits of the *more*-changed slice is at least `--threshold`. That is
   stricter than `coChange`, which divides by the less-changed side: there a small directory
   whose few commits all touched two busy ones would score 1.0 against both and chain them.

Detection is regex-based and errs towards false negatives:

- An Express, Hono or Fastify route needs a string-literal path starting with `/` and a
  handler argument after it. Calls on common HTTP-client receivers (`axios`, `http`,
  `client`, `ky`, `got`, ...) are skipped as outgoing requests.
- A controller action's route joins its class's `[Route("...")]` with the `[Http*("...")]`
  template, or with a method-level `[Route("...")]` when the attribute has none. A
  template starting with `/` or `~/` is absolute.
- A minimal-API route (`Map{Get,Post,Put,Patch,Delete}`) joins the prefixes of the
  `MapGroup` chain its receiver comes from, followed through a local
  (`var auth = app.MapGroup("/api/auth")`) or a method parameter
  (`MapUsers(app.MapGroup("/api/users"))`) within the same file. A helper called with
  several groups reports the route once per group. A method-group handler
  (`MapGet("/", ListUsers)`) is its symbol; a lambda has none.
- Test files (`*.test.*`, `*.spec.*`, and anything under `test/`, `tests/` or
  `__tests__/`) are skipped for `entrypoints` and `envVars`, since their fixtures would
  read as the app's own.

## Adding an ecosystem

Each ecosystem's detection lives in its own file under `detectors/`, exporting one or more
detectors of the shape `{ matches(path), entrypoints(path, text), envPattern }` (`js.mjs`
exports two: source files and `package.json`). `envPattern` is a global regex whose first
non-empty group is an env var name, or `null`. The first detector whose `matches` accepts a
file handles it, so claim files by a name or extension no other detector uses.

To add one:

- Add the file, and import it and list it in `DETECTORS` in `census.mjs`.
- Document any new `kind` or env var source under Output shape, and its rules under the
  detection notes above.
- If the ecosystem names its tests differently (`test_*.py`, `*Test.java`), extend `isTest`
  in `census.mjs`, or its fixtures will read as the app's own entrypoints.

Churn, co-change and the slice plan live in `history.mjs` and need no change.
