---
name: spec
description: Turn a rough idea into a concrete, testable spec through a short back-and-forth, then file it as an `agent-feature` GitHub Issue (`agent:ready`) that `feature` can claim. The front of the Foundry loop — idea in, groomed ticket out. It does not implement. Triggers: brainstorm/scope/spec out a feature or change, turn an idea into a ticket, write up an issue, groom or refine the backlog, "help me write a ticket".
---

# spec

The front half of the Foundry loop, before `feature`. A vague idea becomes a
**schema-complete, testable ticket** an agent can be trusted to work unsupervised.

The deterministic quality gate on the *input* is the **schema** itself — `ticket-schema.md`
+ the `agent-feature` issue form make the fields required, so a malformed ticket can't be
filed (the same "structure enforces quality, not a model" principle as the output `gate`).
This skill is the *assisted author* on top: since `feature`'s output quality is capped by
the ticket's, it helps you produce a schema-satisfying ticket — **eliciting** testable
criteria from you rather than inventing them. **It never writes code and never opens a PR**;
it produces a ticket and hands off to `feature`. You can always author by hand — `spec` just
raises the floor.

## The sequence

### 1. Brainstorm — diverge, then converge

Interview the user. Don't jump to a solution; understand the problem first. Ask about:

- **The problem and the why** — what's broken or missing, and who feels it. One or two
  sentences of user story.
- **Success** — how we'll *know* it's done. Push every "it should work well" toward
  something observable: an input, an action, an expected result.
- **Constraints and prior art** — existing code to build on or match, must-not-breaks,
  relevant modules.
- **The edges** — the empty state, the error path, the concurrent case. These are where
  under-specified tickets go wrong.
- **Done beyond behaviour** - what else has to be true before you would call it done,
  that no acceptance test observes: a doc updated, a consumer told, a follow-up ticket
  filed, an old path removed. Ask rather than assume; "nothing else" is a fine answer.

Ask **one focused round at a time**; reflect back what you heard. Stop when you can state
the change in a sentence and list what would prove it done.

**Ground it in the codemap, when the repo has one.** If `docs/codemap/INDEX.md` exists,
find the slice or slices that own the change from its `## Domains` table and each slice's
`paths:` frontmatter, and read them (the layout and citation grammar are in the `codemap`
skill's `FORMAT.md`). Then:

- **Pointers** come from those slices' citations (`path` or `path#Symbol`), so the agent
  starts from code the map has checked, not from a guess.
- **Edge-case questions** come from the side effects of the traced flows: the side-effect
  steps under each slice's `## Happy paths` and the `## Key cross-domain flows` in the
  INDEX. Ask what should happen when each one fails, repeats or races.
- **The scope-out** names the neighbouring slices from the Domains table that the change
  does not touch, so sprawl into them is visibly out of bounds.

Without `docs/codemap/INDEX.md`, skip this and do not suggest generating one.

### 2. Draft to the schema

Shape the conversation into the [ticket schema](#the-schema). The load-bearing move is the
**acceptance criteria**: a `- [ ]` checklist where each item is independently verifiable
and, where possible, machine-checkable.

- Good: `- [ ] POST /apply with a missing CV returns 422 and the body names the field`
- Weak: `- [ ] the apply flow is robust` — not checkable; rewrite or drop it.

Draft the done-conditions from step 1 as a separate **Definition of Done** checklist, not
folded into the acceptance criteria: the AC say what the change does, the DoD says what
else has to be true. When step 1 turned up nothing, write the sentinel
`None beyond the acceptance criteria.` so the absence is a decision, not an omission.

Force an explicit **scope-out** ("does *not* touch X"): it's the single highest-leverage
line for stopping an agent (or a human) sprawling. If the idea is really several changes,
say so and split it into multiple tickets, noting the order/dependencies — one ticket is
one cohesive, reviewable change.

### 3. Critique before filing

Self-check the draft, and fix what fails:

- Every acceptance criterion is verifiable — no "nice", "clean", "robust".
- Every DoD item is verifiable, and none restates what the gate or `ship` already
  enforces on every change ("the gate is green", "tests pass", "it was reviewed", "CI
  passes", "a PR is open"). Drop those; rewrite or drop anything that can't be checked.
- Scope-out is present and specific.
- Every pointer path exists in the working tree: check each with `test -e <path>`, on the
  part before any `#Symbol`. Fix or drop any that doesn't; a dead pointer sends the agent
  hunting for code that isn't there. Pointers that are not paths (a dependency on another
  issue, a doc URL) are left alone.
- The whole thing is one cohesive change, sized to a single PR.

### 4. Confirm with the user

Show the drafted ticket in full, Definition of Done included, and iterate until they
approve it. This is the last cheap place to change direction - cheaper than a `feature`
loop or a review round.

Step 5 runs only on an explicit approval of the whole ticket ("approved", "file it",
"yes, that's the ticket"). An ambiguous reply is not approval: "looks fine I guess", a
yes with a change attached, a question, or silence. Apply any change, show the ticket
again, and ask directly whether to file it. The DoD is what `feature` and `review` will
hold the work to, so the user has to have agreed to it, not just seen it.

### 5. File it

Ensure the labels exist (idempotent; GitHub silently drops an unknown label):

```bash
bash scripts/setup-labels.sh 2>/dev/null || true
```

File the issue on the `agent-feature` form so the schema is enforced, stamp it ready, and
assign it to the owner so it shows in their queue until an agent claims it (the claim in
`feature` removes the assignee):

```bash
gh issue create --title "<intent, one line>" --label agent:ready --assignee @me --body-file <spec.md>
```

The body follows the form's sections (Intent / Acceptance criteria / Definition of Done /
Scope boundaries / Pointers). The Definition of Done section is never empty or left out:
it holds the approved checklist or the sentinel `None beyond the acceptance criteria.`
If `gh` or a GitHub remote is unavailable, write the ticket to `tickets/<slug>.md` (the
`feature` fallback source) instead, and say so.

### 6. Hand off

Print the issue number and the handoff, and stop:

> Filed #<n> (`agent:ready`). Work it with `/feature <n>`, or leave it for the backlog
> puller (`/loop /feature`).

Do **not** continue into implementation — that's `feature`'s job, in its own worktree.

## The schema

The required fields (authoritative copy: Foundry's `presets/tickets/ticket-schema.md`,
enforced by `ISSUE_TEMPLATE/agent-feature.yml`):

- **Intent** — the user story: what and why. What the fresh-context reviewer checks the
  diff against.
- **Acceptance criteria** — a `- [ ]` checklist, each item verifiable. The load-bearing
  field: `feature`'s `verify` step and `ship`'s spec review both walk it item by item.
- **Definition of Done** - a `- [ ]` checklist of ticket-specific done-conditions that are
  not behaviour, each verifiable, none restating the gate or `ship`. Or the sentinel
  `None beyond the acceptance criteria.` A ticket without this section is not claimable.
- **Scope boundaries** — explicit "do not touch X".
- **Pointers** — files, modules, prior art to start from.

## Stop conditions

Stop and ask, rather than guessing, if:

- the user can't yet articulate how success would be observed — keep brainstorming, don't
  invent acceptance criteria for them.
- the idea is too large for one ticket — propose a split and let them pick the first slice.
- filing needs labels/permissions you don't have — produce the ticket file and say what's
  needed.
