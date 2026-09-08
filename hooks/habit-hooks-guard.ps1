# Foundry — in-loop habit check (DESIGN.md §2, "reflex" placement).
#
# Runs habit-hooks when Claude is about to finish, but ONLY in repos that have
# opted in by having a .habit-hooks/ directory. Silent and near-zero cost in
# every other repo, so this is safe to install globally.
#
# Placement note: this is a Stop hook rather than PostToolUse because
# habit-hooks takes ~25s on a mid-size repo — far too slow to fire after every
# edit. It also matches habit-hooks' own guidance: "run it before considering
# work complete."

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

$output = & $hh.Source 2>&1
if ($LASTEXITCODE -eq 0) { exit 0 }

# Exit code 2 blocks the stop and feeds stderr back to Claude as coaching.
[Console]::Error.WriteLine(($output | Out-String))
exit 2
