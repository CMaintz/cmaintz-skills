#!/usr/bin/env node
// Deterministic inventory of a repo for the codemap skill: manifests, entrypoints, schemas,
// env vars, churn, co-change and a proposed slice plan, as JSON on stdout. Facts only, no
// model calls: the same working tree and the same --since print the same output. The
// default --since is relative to now, so pass an absolute date for runs that must match
// later. The output shape is documented in README.md next to this script.
//
//   node census.mjs [--since "12 months ago"] [--threshold 0.5] [--min-shared 3]

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dotenv } from './detectors/dotenv.mjs';
import { dotnet } from './detectors/dotnet.mjs';
import { js, packageJson } from './detectors/js.mjs';
import { commitsSince, countChurn, coupledPairs, planSlices } from './history.mjs';
import { byText, git } from './repo.mjs';

const DEFAULTS = { since: '12 months ago', threshold: 0.5, minShared: 3 };
const MAX_BYTES = 1_000_000;

const MANIFEST_NAMES = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'pyproject.toml']);
const MANIFEST_EXTS = new Set(['.csproj', '.sln']);

// Each detector claims files by name or extension, and the first match handles a file, so a
// detector added later cannot report the same entrypoint twice. See README.md for adding one.
const DETECTORS = [dotenv, packageJson, js, dotnet];

/** Tracked plus untracked-but-not-ignored files, so gitignored paths never reach a detector. */
function listFiles(root) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort(byText);
}

// Copied third-party code (a vendored client, a Go vendor tree) is not the app's own, so its
// manifests, routes and env vars would read as features of the repo being mapped.
const VENDOR_DIR = /(^|\/)(vendor|third_party)\//;

/** Files that are not vendored, by directory convention or the `linguist-vendored` attribute. */
function ownFiles(root, files) {
  if (files.length === 0) return files;
  const out = git(root, ['check-attr', '-z', '--stdin', 'linguist-vendored'], `${files.join('\0')}\0`).split('\0');
  const vendored = new Set();
  for (let i = 0; i + 2 < out.length; i += 3) if (out[i + 2] === 'set' || out[i + 2] === 'true') vendored.add(out[i]);
  return files.filter((f) => !vendored.has(f) && !VENDOR_DIR.test(f));
}

function read(root, path) {
  try {
    const full = posix.join(root.replaceAll('\\', '/'), path);
    if (statSync(full).size > MAX_BYTES) return '';
    return readFileSync(full, 'utf8');
  } catch {
    return '';
  }
}

function isManifest(path) {
  const base = posix.basename(path);
  return MANIFEST_NAMES.has(base) || MANIFEST_EXTS.has(posix.extname(base));
}

// Test code registers routes and sets env vars as fixtures, which would read as the app's own.
const isTest = (path) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[^/]+$/.test(path);

function isSchema(path) {
  return (
    path.endsWith('.sql') ||
    posix.basename(path) === 'schema.prisma' ||
    /(^|\/)migrations\//i.test(path)
  );
}

/** The census of the git repo at `root`. Throws if `root` is not inside a git work tree. */
export function census(root = process.cwd(), opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  const top = git(root, ['rev-parse', '--show-toplevel']).trim();
  const files = ownFiles(top, listFiles(top));

  const entrypoints = [];
  const env = new Map();
  for (const path of files) {
    if (isTest(path)) continue;
    const detector = DETECTORS.find((d) => d.matches(path));
    if (!detector) continue;
    const text = read(top, path);
    entrypoints.push(...detector.entrypoints(path, text));
    for (const m of detector.envPattern ? text.matchAll(detector.envPattern) : []) {
      const name = m.slice(1).find(Boolean);
      env.set(name, new Set([...(env.get(name) ?? []), path]));
    }
  }

  const commits = commitsSince(top, options.since, new Set(files));
  const churn = [...countChurn(commits)]
    .map(([path, commitCount]) => ({ path, commits: commitCount }))
    .sort((x, y) => y.commits - x.commits || byText(x.path, y.path));

  const { slices, unsliced } = planSlices(files, commits, options);
  return {
    manifests: files.filter(isManifest),
    entrypoints: entrypoints.sort((x, y) => byText(x.path, y.path) || (x.line ?? 0) - (y.line ?? 0)),
    schemas: files.filter(isSchema),
    envVars: [...env]
      .map(([name, paths]) => ({ name, files: [...paths].sort(byText) }))
      .sort((x, y) => byText(x.name, y.name)),
    churn,
    coChange: coupledPairs(commits, options),
    slicePlan: slices,
    unsliced,
  };
}

const FLAGS = { '--since': ['since', String], '--threshold': ['threshold', Number], '--min-shared': ['minShared', Number] };

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=');
    const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    if (!FLAGS[flag]) throw new Error(`unknown argument: ${argv[i]}`);
    const value = eq === -1 ? argv[++i] : argv[i].slice(eq + 1);
    if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
    const [key, type] = FLAGS[flag];
    if (type === Number && !Number.isFinite(Number(value))) throw new Error(`${flag} must be a number, got "${value}"`);
    opts[key] = type(value);
  }
  return opts;
}

// realpath on both sides: reached through a symlink or junction, argv[1] is the link while
// import.meta.url is the target, and a plain comparison would silently print nothing.
function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`census: ${error.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(census(process.cwd(), opts), null, 2)}\n`);
}
