---
name: foundry-secret
description: Triage a secret-scanner finding (gitleaks) and act on it — allowlist a confirmed false positive, or guide rotate-then-purge for a real leaked secret. Use when a secret scan flags something, or the user asks to handle a gitleaks/secret finding.
---

# foundry-secret

Turn a gitleaks finding into the right action. **The core rule: secrets are not
ratcheted.** A code smell that predates the gate is harmless debt you fix later;
a *real* leaked secret is an active vulnerability at any age. So there are only
two honest outcomes for a finding, and which one applies is a judgement call that
must be made per-finding — never a blanket "accept everything that exists".

## Step 1 — identify

From the finding, get: the **file**, the **rule** (e.g. `gcp-api-key`,
`generic-api-key`), the **value** (redacted is fine), and whether it's in
**current code** or **only in history** (a full-history scan flags old commits
even after the file changed).

## Step 2 — classify: real secret, or false positive?

Ask the user if there is *any* doubt. Do not assume. Guidance:

**False positive** (not actually a credential):
- Public-by-design config — e.g. a **Firebase web API key** (ships in the client
  bundle; secured by Firebase Rules + authorized domains, not secrecy).
- **Test fixtures / dummy values** — obviously fake (`sk-proj-abc...123`,
  `test-secret-...`), used only to exercise code.
- Example/placeholder files (`environment.example.ts`).

**Real secret** (a live credential): a provider token, private key, DB password,
service-account JSON, session-signing key, etc. that actually grants access.

## Step 3a — false positive → allowlist (precise, reviewed)

Add a **narrow** entry to `.gitleaks.toml`, never a blanket rule:

```toml
[allowlist]
paths = [
  '''path/to/the/exact/file\.ext$''',
]
```

- Prefer the **specific file/path**; avoid exempting whole directories (that would
  hide a *real* secret added there later).
- Add a one-line note in the PR on *why* it's not a secret.
- Open it as its own small PR.

Remember: routine push/PR scans are **incremental** (new commits only), so real
new secrets are still caught; the allowlist only quiets the occasional
full-history audit for confirmed non-secrets.

## Step 3b — real secret → rotate, THEN purge

Order matters. The secret is already exposed the moment it was committed
(especially if pushed), so:

1. **Rotate / revoke first.** Invalidate the credential at the provider *now* —
   this is the only step that actually stops the bleeding. Purging history
   without rotating is theatre; the secret is already out.
2. **Remove from current code** — replace with an env var / secret manager
   reference; add the file to `.gitignore` if it should never be committed.
3. **Purge from history** — `git filter-repo` (preferred) or BFG to strip the
   value from all commits. This **rewrites history and needs a force-push**, so:
   confirm with the user, coordinate if the repo is shared, and expect every
   clone to need a re-clone/reset.
4. **Verify** — re-run the scanner; confirm zero findings for that value.

Never allowlist a real secret. Allowlisting hides an active vulnerability.

## Stop conditions

- Unsure whether a finding is real → **ask the user**, don't guess.
- About to force-push a history rewrite → **confirm first**, and confirm rotation
  happened before the purge.
