# Foundry — format-on-write (DESIGN.md §2, "reflex" placement).
#
# PostToolUse hook (Edit|Write|MultiEdit). Formats the single file just written
# so formatting is fixed LEFT OF CI — the gate's format check then almost never
# fails, and the agent never burns a round-trip on a whitespace nit.
#
# Opt-in by tooling: it only acts when the edited file's project has a local
# formatter (prettier, else eslint) installed, so it is a silent no-op in every
# other repo and safe to install globally.
#
# Scope: the one edited file only (fast — sub-second). Java/Kotlin are
# intentionally skipped: Spotless/ktlint run through Gradle and cost seconds of
# JVM startup per edit, which is intolerable on every keystroke. Those are
# handled by the `fix` verb / the gate / `/ship`, not here.

$ErrorActionPreference = 'SilentlyContinue'

# Claude Code passes a JSON payload on stdin; the edited path is tool_input.file_path.
$raw = [Console]::In.ReadToEnd()
$payload = $null
if ($raw) { try { $payload = $raw | ConvertFrom-Json } catch { $payload = $null } }
if (-not $payload) { exit 0 }

$file = $payload.tool_input.file_path
if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { exit 0 }

# Only the extensions a fast single-file formatter handles well.
$ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
$web = '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
       '.css', '.scss', '.less', '.html', '.vue', '.svelte', '.md', '.mdx',
       '.yaml', '.yml', '.graphql'
if ($web -notcontains $ext) { exit 0 }

# Walk up from the file to the nearest package that has a local formatter
# (handles monorepos — e.g. frontend/node_modules under a repo root).
# .NET path methods, not Split-Path: `Split-Path -LiteralPath -Parent` is an
# invalid parameter-set combo in PowerShell 7 and throws.
$dir = [System.IO.Path]::GetDirectoryName($file)
$bin = $null
while ($dir) {
  $cand = Join-Path $dir 'node_modules\.bin'
  if (Test-Path -LiteralPath $cand -PathType Container) { $bin = $cand; break }
  $parent = [System.IO.Path]::GetDirectoryName($dir)
  if (-not $parent -or $parent -eq $dir) { break }
  $dir = $parent
}
if (-not $bin) { exit 0 }

function Find-Tool([string]$name) {
  foreach ($n in @("$name.cmd", "$name.ps1", $name)) {
    $p = Join-Path $bin $n
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
  }
  return $null
}

# prettier is the formatter of record (fast, deterministic, respects
# .prettierignore). eslint --fix is the fallback for repos that format via lint
# rules without prettier. Deeper lint autofix still happens in the gate/fix verb.
$prettier = Find-Tool 'prettier'
if ($prettier) {
  & $prettier --write --log-level warn -- "$file" | Out-Null
  exit 0
}
$eslint = Find-Tool 'eslint'
if ($eslint) {
  & $eslint --fix -- "$file" | Out-Null
  exit 0
}
exit 0
