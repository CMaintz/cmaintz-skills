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

Ask **one focused round at a time**; reflect back what you heard. Stop when you can state
the change in a sentence and list what would prove it done.

### 2. Draft to the schema

Shape the conversation into the [ticket schema](#the-schema). The load-bearing move is the
**acceptance criteria**: a `- [ ]` checklist where each item is independently verifiable
and, where possible, machine-checkable.

- Good: `- [ ] POST /apply with a missing CV returns 422 and the body names the field`
- Weak: `- [ ] the apply flow is robust` — not checkable; rewrite or drop it.

Force an explicit **scope-out** ("does *not* touch X"): it's the single highest-leverage
line for stopping an agent (or a human) sprawling. If the idea is really several changes,
say so and split it into multiple tickets, noting the order/dependencies — one ticket is
one cohesive, reviewable change.

### 3. Critique before filing

Self-check the draft, and fix what fails:

- Every acceptance criterion is verifiable — no "nice", "clean", "robust".
- Scope-out is present and specific.
- Pointers name real files/modules the agent should start from.
- The whole thing is one cohesive change, sized to a single PR.

### 4. Confirm with the user

Show the drafted ticket in full and iterate until they approve. This is the last cheap
place to change direction — cheaper than a `feature` loop or a review round.

### 5. File it

Ensure the labels exist (idempotent; GitHub silently drops an unknown label):

```bash
bash scripts/setup-labels.sh 2>/dev/null || true
```

File the issue on the `agent-feature` form so the schema is enforced, and stamp it ready:

```bash
gh issue create --title "<intent, one line>" --label agent:ready --body-file <spec.md>
```

The body follows the form's sections (Intent / Acceptance criteria / Scope boundaries /
Pointers). If `gh` or a GitHub remote is unavailable, write the ticket to `tickets/<slug>.md`
(the `feature` fallback source) instead, and say so.

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
- **Scope boundaries** — explicit "do not touch X".
- **Pointers** — files, modules, prior art to start from.

## Stop conditions

Stop and ask, rather than guessing, if:

- the user can't yet articulate how success would be observed — keep brainstorming, don't
  invent acceptance criteria for them.
- the idea is too large for one ticket — propose a split and let them pick the first slice.
- filing needs labels/permissions you don't have — produce the ticket file and say what's
  needed.
