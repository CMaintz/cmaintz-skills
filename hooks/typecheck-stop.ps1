# Foundry — in-loop typecheck reflex (DESIGN.md §2, "reflex" placement).
#
# habit-hooks-guard checks structural smells at Stop; this catches TYPE errors at
# Stop too — a full turn before `/ship` would. Runs `mise run typecheck` once per
# turn, only when the turn touched source and the repo exposes the verb. exit 2
# feeds the errors back as coaching, the same contract habit-hooks-guard uses.
#
# Cost note: this is heavier than the per-edit formatters — `mise run typecheck`
# is tsc / gradle compile / mypy over the project. It's once-per-turn and only on
# code-touching turns, but on a Gradle repo that's a few seconds. Opt-in.

$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
$payload = $null
if ($raw) { try { $payload = $raw | ConvertFrom-Json } catch { $payload = $null } }
if ($payload -and $payload.stop_hook_active) { exit 0 }
if ($payload -and $payload.cwd) { Set-Location -LiteralPath $payload.cwd }

$mise = Get-Command mise -ErrorAction SilentlyContinue
if (-not $mise) { exit 0 }
if (-not (Test-Path -LiteralPath 'mise.toml')) { exit 0 }
# Only if the repo actually defines the verb (don't coach on a missing task).
if ((& $mise.Source tasks 2>$null | Out-String) -notmatch 'typecheck') { exit 0 }

# Only when the turn touched code — skip docs-only turns.
$changed = @()
$changed += & git diff --name-only HEAD 2>$null
$changed += & git ls-files --others --exclude-standard 2>$null
$mb = & git merge-base HEAD origin/main 2>$null
if ($mb) { $changed += & git diff --name-only $mb HEAD 2>$null }
if (-not ($changed | Where-Object { $_ -match '\.(ts|tsx|js|jsx|java|kt|kts|cs|py|php)$' })) { exit 0 }

$out = & $mise.Source run typecheck 2>&1
if ($LASTEXITCODE -eq 0) { exit 0 }
[Console]::Error.WriteLine("Type check failed — resolve before finishing:`n" + ($out | Out-String))
exit 2
