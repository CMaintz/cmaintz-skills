---
name: verify
description: Check a change against its ticket - every acceptance criterion and every Definition of Done item, including DoD items outside the diff - in a fresh-context, read-only subagent that returns pass or fail with evidence per item. Advisory like `review`; it blocks nothing. Use when the user says "verify", asks to check the acceptance criteria or the DoD, or asks "does this meet the ticket?". `feature` and `ship` call it before a ticket's change ships. Accepts an optional ticket ref.
---

# verify

A green gate proves the code is clean, not that it does what the ticket asked. `verify` checks that, item by item, in a context that never saw the code being written: the context that wrote it reads its own intent into the diff.

**Advisory only. It never blocks and never edits anything.** Only the gate blocks. `verify` reports; whoever called it decides what to do with a fail.

## Inputs

1. **The ticket.** `<ticket-ref>` when given: `gh issue view <ref> --json number,title,body`. Otherwise the issue the current branch or PR links: `gh pr view --json closingIssuesReferences`, then a `#<n>` or trailing `-<n>` in the branch name, then a `Closes #<n>`/`Refs #<n>` in the branch's commits. **No ticket found: say so and stop.** Never invent criteria from the diff, the commits or the conversation.
2. **The change.** A PR or branch when given (`gh pr diff <pr>`, or `git diff <base>...<branch>`). Otherwise the working tree against its base, `git diff $(git merge-base HEAD origin/<default>)` (the default branch from `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`), plus the new files `git ls-files --others --exclude-standard` lists.

## The check

Spawn one fresh general-purpose subagent and give it only:

- the ticket body,
- the diff and the list of new files,
- the means to check: the worktree path, so it can run the tests and the app (the `run` skill), and `gh` for Definition of Done items outside the diff (a follow-up ticket filed, a consumer told).

Never hand it your reasoning, a summary of what was done, or which items you think pass. It is read-only: it runs commands and reads files, and edits, commits, comments on and labels nothing.

It walks every acceptance criterion, then every Definition of Done item, and returns one row per item:

| Item | Verdict | Evidence |
|---|---|---|
| the item's text | pass, fail, or can't check | the command and its output, a `file:line`, or a link |

An item it can't settle from what it was given is "can't check" with the reason, never a pass. The DoD sentinel `None beyond the acceptance criteria.` adds no rows. A ticket with no DoD section at all gets one fail row saying so.

## Report

Relay the table as returned, then one line: all passed, or which items failed or couldn't be checked. Name the commit it ran on (`git rev-parse --short HEAD`) and whether the tree had uncommitted changes, so a later caller can tell whether the verdict still holds.
