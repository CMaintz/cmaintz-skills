# Foundry — in-loop habit check (DESIGN.md §2, "reflex" placement).
#
# Runs habit-hooks when Claude is about to finish, but ONLY in repos that have
# opted in by having a .habit-hooks/ directory. Silent and near-zero cost in
# every other repo, so this is safe to install globally.
#
# Placement note: this is a Stop hook rather than PostToolUse because it fires
# once, before work is declared complete (matching habit-hooks' own guidance),
# rather than after every edit.
#
# Scope note: runs `--branch`, i.e. only files changed vs the branch base, not
# the whole repo (`--all`). That is both the right scope for an in-loop check
# (flag what you touched) and necessary on Windows, where passing every path in
# a large repo to the detector blows the ~8191-char command-line limit. It is
# also fast (a few seconds) since it scans a changeset, not hundreds of files.

$ErrorActionPreference = 'SilentlyContinue'

# Claude Code passes a JSON payload on stdin.
$raw = [Console]::In.ReadToEnd()
$payload = $null
if ($raw) { try { $payload = $raw | ConvertFrom-Json } catch { $payload = $null } }

# Critical: without this the hook can re-trigger itself forever when findings
# persist. stop_hook_active is true when we are already inside a stop-hook loop.
if ($payload -and $payload.stop_hook_active) { exit 0 }

if ($payload -and $payload.cwd) { Set-Location -LiteralPath $payload.cwd }

# Opt-in gate.
if (-not (Test-Path -LiteralPath '.habit-hooks' -PathType Container)) { exit 0 }

$hh = Get-Command habit-hooks -ErrorAction SilentlyContinue
if (-not $hh) { exit 0 }

$output = & $hh.Source --branch 2>&1
if ($LASTEXITCODE -eq 0) { exit 0 }

# Exit code 2 blocks the stop and feeds stderr back to Claude as coaching.
[Console]::Error.WriteLine(($output | Out-String))
exit 2
