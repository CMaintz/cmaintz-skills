---
name: codemap
description: Map a repo into a committed, cited, SHA-stamped picture of the codebase under docs/codemap/ (an INDEX plus one file per domain slice and three lenses), so every session starts from the same verified map; `refresh` re-audits only the slices whose cited files changed. It describes, it never judges, and it hands its output to `ship` as a docs PR. Triggers: map the codebase, build or update a code map, onboard to an unfamiliar repo, "how is this repo laid out", refresh or update the codemap, the codemap is stale.
---

# codemap

A map of the repo that every session can trust: each behavioural claim cites the code it
came from, each file records the commit it was checked against, and a verifier has
spot-checked the claims before anything is written. The format is fixed in
[FORMAT.md](FORMAT.md); read it before writing a file.

**It describes, it never judges.** No smells, risks, debt or recommendations. For those,
point the user at `repo-align` (structural debt) or `hotspot-rec` (where maintenance cost
lives). A map that mixes in findings stops being a neutral reference.

**It never commits.** Its output goes to `ship` as its own `docs(codemap): ...` PR.

## Modes

- **`/codemap`**: build the full map. Run it when `docs/codemap/` does not exist, or to
  rebuild it from scratch.
- **`/codemap refresh`**: update only the slices whose cited files changed since their
  stamped `sha`. See [Refresh](#refresh).

## Before you start

Stop if any fails:

1. **A clean working tree.** Every file gets stamped with `git rev-parse HEAD`, so the
   claims must be read from exactly that commit. Uncommitted changes would make the stamp
   lie.
2. **Not on the default branch.** Create `docs/codemap` (or `docs/codemap-refresh`) first,
   so `ship` has a branch to open the PR from.
3. **The census runs.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/codemap/census.mjs"` prints JSON.
   Its output shape is documented in the script's `README.md` next to it.

## The sequence

Phases 2 and 3 produce drafts, held in memory. **Nothing is written to `docs/codemap/`
until phase 4 has verified them.** Then all files are written together, so a refuted claim
never lands on disk, not even briefly.

### Phase 1: census and slice plan

Run the census and show the user the plan before any agent is spawned:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codemap/census.mjs"
```

The census `slicePlan` is a proposal from directory layout and co-change, so refine it
before showing it: merge slices too small to audit alone into the domain they serve, and
give a slice joined from many paths a short domain name. Its `unsliced` list (tests, docs,
infra, config) is context for the lens agents, not a slice of its own.

Show each slice as its name, paths, file count and the file name it will get (FORMAT.md's
slug rule), then the three lenses, and the census counts (manifests, entrypoints, schemas,
env vars). Say which mode phase 2 will use (fan-out or single agent).

**Wait for the user to confirm or edit the plan.** They may merge slices, split one, rename
one, or drop a directory that is not code (fixtures, vendored code, docs). Census slicing
is a guess from directory layout and co-change; the user knows the domains. Spawn nothing
until they confirm.

### Phase 2: audit the slices

**Fan-out (more than 2 slices).** Spawn, in parallel, one fresh sub-agent per domain slice
plus three lens agents: data model, integrations, and runtime/config/deploy. A fresh
context matters for the same reason it does in `review`: the agent reads the code, not a
story about it.

**Single agent (at most 2 slices).** One agent does every slice and all three lenses in
turn. Fan-out costs more than it buys on a repo this small.

Give each agent:

- FORMAT.md, and the section for its file kind.
- Its slice's paths (domain) or its lens brief (lens).
- The census entries that fall in its scope: `entrypoints`, `schemas`, `envVars`, and the
  `coChange` pairs that touch its paths, so it starts from facts rather than a guess.
- The rules: every behavioural claim carries a citation; anything it cannot confirm in the
  code goes to `## Unknowns` as a question; no findings; return the file's markdown, write
  nothing.

A domain agent traces the **top 2 or 3 happy paths** from entrypoint to persistence to side
effects, reading the code along each path rather than inferring it from names. Choose the
paths the slice exists for, using the census entrypoints and churn as a guide.

### Phase 3: draft the INDEX

From the drafts, compose `INDEX.md` per FORMAT.md: domains, key cross-domain flows, where
things live, known unknowns. **Under 150 lines.** It is a table of contents with the
cross-cutting picture, not a summary of every slice; detail stays in the slice files. The
cross-domain flows come from where one slice's happy path calls into another's.

### Phase 4: verify, then write

Spawn one fresh verifier sub-agent with all the drafts and the repo. It does two checks:

1. **Every citation resolves**, per FORMAT.md: the path exists and, for `path#Symbol`, the
   symbol is defined in that file. Check each one with `git ls-files` and a grep for the
   declaration.
2. **Spot-check the claims.** Pick at least 5 behavioural claims per file (all of them in a
   file with fewer), weighted toward happy-path steps and entity ownership, read the cited
   code, and judge whether it does what the claim says.

It returns each failure as file, claim, citation and what the code actually shows.

For each refuted claim, either **fix it** from what the verifier found (and re-check the
fix), or **move it to `## Unknowns`** as a question. Never keep it as written. Then:

```bash
git rev-parse HEAD   # the sha for every file
```

Write all files under `docs/codemap/` with that `sha`, and show the user the file list,
the line count of `INDEX.md`, and how many claims the verifier refuted and how each was
resolved.

### Phase 5: hand to ship

Invoke **`foundry:ship`** with the `docs/codemap/` changes as the whole diff, titled
`docs(codemap): map the repo` (or `docs(codemap): refresh <slices>`). Do not mix code
changes into this PR.

## Refresh

`/codemap refresh` re-audits only what went stale.

1. **Find what changed per file.** For each slice and lens file under `docs/codemap/` (not
   `INDEX.md`, which step 5 handles), read its `sha` and list the changes since:

   ```bash
   git diff --name-status <sha> HEAD
   ```

   If `<sha>` is not reachable (a rebase or squash rewrote it), treat that whole file as
   stale.

2. **Map changes to slices through citations.** A slice or lens file is stale when a changed
   path matches one of its citations: the same file, or a file under a cited directory. A
   deleted or renamed path counts as changed, since its citation no longer resolves.

3. **Nothing stale? Stop.** Say no cited file changed since the stamps, write nothing, and do
   not invoke `ship`. A refresh with nothing to do leaves the tree untouched.

4. **Re-audit only the stale files** through phases 2 and 4, with the existing file as the
   starting draft and the changed paths named. Run the census again for current facts.
   Restamp only those files with the current `HEAD`. Untouched files keep their old `sha`,
   because their claims are still true at it.

5. **Update the INDEX.** Redraft its content only when a re-audited file changed its
   purpose, its flows or its unknowns, or when one of its own citations changed. Either way,
   restamp it with the current `HEAD`, since its `sha` is always the newest among the files.
   Then verify and hand to `ship` as above.

A changed file that no citation covers (a new file in a slice's paths) does not make the
slice stale by itself. If the census shows new entrypoints or schemas inside a slice, name
them to the user and offer a full rerun of that slice.

## Rules

- **Cite or ask.** A claim without a citation is a question in `## Unknowns`.
- **Describe, never judge.** Findings go to `repo-align` and `hotspot-rec`.
- **Write only after verifying**, and only under `docs/codemap/`.
- **Never commit.** `ship` does that, as its own PR.
