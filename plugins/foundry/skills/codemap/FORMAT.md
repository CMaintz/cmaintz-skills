# codemap format

The contract for what `codemap` writes. `refresh` and any later reader parse these files,
so the layout, the frontmatter and the citation grammar are fixed; the prose is not.

## Layout

```
docs/codemap/
  INDEX.md            the entry point, under 150 lines
  <slice>.md          one per domain slice from the census slicePlan
  data-model.md       lens: entities, schemas, migrations
  integrations.md     lens: external services in and out
  runtime.md          lens: runtime, config and deploy
```

`<slice>` is the slice's name from the confirmed plan with every `/` replaced by `-`. An
unedited census slice keeps its `slicePlan[].name`, so `src/billing+src/orders` becomes
`src-billing+src-orders.md`; a slice the user merged, split or renamed in phase 1 takes the
name they confirmed (`auth`, `analyses`). A slice whose name would collide with `INDEX`,
`data-model`, `integrations` or `runtime` gets a `slice-` prefix. Slice names in a plan are
unique, so the file names are too.

## Frontmatter

Every file starts with YAML frontmatter:

```yaml
---
sha: 3f2c9e1a7b...          # full SHA of the commit the file was audited against
slice: src/billing+src/orders   # slice name from the plan, or the lens name, or "index"
kind: domain                 # domain | lens | index
paths: [src/billing, src/orders]   # domain slices only: the slice's paths from the plan
---
```

`sha` is the commit whose tree the claims were checked against. It is always a full SHA from
`git rev-parse HEAD`, taken from a clean working tree, so the stamp and what was read agree.
`refresh` diffs from it. A file that was not re-audited keeps its old `sha`.

## Citations

A citation is a backticked span of one of two forms:

- `` `path` ``: a repo-relative file or directory, with `/` separators.
- `` `path#Symbol` ``: a symbol defined in that file. `Symbol` is an identifier
  (`[A-Za-z_$][A-Za-z0-9_$]*`), and dotted segments are allowed for a member
  (`OrdersController.Create`, `billing.charge`).

Examples: `` `src/orders/service.ts#createOrder` ``, `` `src/Api/Controllers/UsersController.cs#UsersController.GetById` ``,
`` `prisma/schema.prisma` ``, `` `db/migrations/` ``.

A backticked span with no spaces is a citation when its path part contains `/` or `.` and
either the span contains `#` or the path exists in the tree at the file's `sha`. So `C#` or
a hex colour is never a citation. Other backticked text (a route like `GET /health`, a
MIME type, a command) is plain code. A `path#Symbol` whose path is missing is a broken
citation, not plain code. No line numbers: they go stale on every unrelated edit, while a
symbol survives them.

A citation resolves when the path exists and, for `path#Symbol`, the last segment of
`Symbol` is defined in that file (a declaration, not just a mention).

## Claims

**Every behavioural claim carries at least one citation.** A behavioural claim is anything
about what the code does: a step in a flow, an entity's owner, where a value comes from, what
an endpoint writes, what a job sends. A claim with no citation, or one the verifier cannot
confirm in the code, goes under `## Unknowns` as a question instead.

The map describes; it does not judge. No smells, risks, debt or recommendations. Those
belong to `repo-align` and `hotspot-rec`.

## Domain slice file

```markdown
## Purpose
One or two sentences: what this slice is for, cited.

## Features
- What a user or caller can do through this slice, each cited.

## Owned entities
- The data this slice creates and is the writer of, each cited to its definition.

## Happy paths
### <name of the path>
1. Entrypoint: the route, command, job or handler, cited.
2. Each step through to persistence, cited.
3. Side effects: events, messages, mail, external calls, cited.

(Two or three paths: the ones the slice exists for.)

## Unknowns
- What could not be confirmed from the code, as a question.
```

## Lens files

Same frontmatter with `kind: lens`, then:

- `data-model.md`: entities and their fields of note, schemas and migrations, relationships,
  and which slice owns (writes) each entity.
- `integrations.md`: every external system, inbound (webhooks, consumers) and outbound
  (HTTP clients, queues, mail, storage), with the env vars or config each one reads.
- `runtime.md`: processes and entrypoints, configuration and env vars, build, CI and deploy
  (Dockerfiles, IaC, workflows).

Each ends with `## Unknowns`.

## INDEX.md

`kind: index`, `slice: index`, and `sha` equal to the newest `sha` among the other files.
Under 150 lines, with these sections:

- `## Domains`: a table of slice, file, and a one-line purpose.
- `## Key cross-domain flows`: the flows that cross slices, as short cited step lists,
  linking to the slice files for detail.
- `## Where things live`: entrypoints, data model, config, tests, CI, each with a citation.
- `## Known unknowns`: the most important open questions from all files, linked to their file.
