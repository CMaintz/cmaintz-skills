# Foundry — format Java on Stop (DESIGN.md §2, "reflex" placement).
#
# The fast web formatters run per-edit (auto-format.ps1). Spotless can't: Gradle
# JVM startup is seconds, so firing it on every keystroke would dominate the
# agent's wall-clock. So Java is formatted ONCE per turn, at Stop, and only when
# the turn actually touched Java. Spotless `ratchetFrom origin/main` already scopes
# the rewrite to changed files, so untouched files are never reformatted. It's the
# same formatter config CI's Spotless check uses — just applied at the turn
# boundary instead of at the gate, so a whitespace nit never reaches the PR.
#
# Opt-in by tooling: no Gradle wrapper, or no spotless in the build => silent no-op.

$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
$payload = $null
if ($raw) { try { $payload = $raw | ConvertFrom-Json } catch { $payload = $null } }
# Guard against a stop-hook loop (a co-installed Stop hook may re-enter).
if ($payload -and $payload.stop_hook_active) { exit 0 }
if ($payload -and $payload.cwd) { Set-Location -LiteralPath $payload.cwd }

$gradlew = if (Test-Path -LiteralPath './gradlew.bat') { './gradlew.bat' }
           elseif (Test-Path -LiteralPath './gradlew') { './gradlew' }
           else { $null }
if (-not $gradlew) { exit 0 }

# Cheap guard: is Spotless even configured? Avoids a pointless ~3s Gradle spin-up
# in Gradle repos that don't use it.
$builds = Get-ChildItem -Path . -Recurse -Depth 2 -Include 'build.gradle', 'build.gradle.kts' -File -ErrorAction SilentlyContinue
if (-not ($builds | Select-String -Pattern 'spotless' -List -ErrorAction SilentlyContinue)) { exit 0 }

# Did this turn touch Java? Working tree + new files + branch commits vs main.
$changed = @()
$changed += & git diff --name-only HEAD 2>$null
$changed += & git ls-files --others --exclude-standard 2>$null
$mb = & git merge-base HEAD origin/main 2>$null
if ($mb) { $changed += & git diff --name-only $mb HEAD 2>$null }
if (-not ($changed | Where-Object { $_ -like '*.java' })) { exit 0 }

# ratchetFrom origin/main scopes the rewrite to changed files. Silent, non-blocking.
& $gradlew spotlessApply --quiet --console=plain 2>&1 | Out-Null
exit 0
