#!/usr/bin/env node
// Deterministic inventory of a repo for the codemap skill: manifests, entrypoints, schemas,
// env vars, churn, co-change and a proposed slice plan, as JSON on stdout. Facts only, no
// model calls, so two runs on the same working tree print the same output on any machine.
// The output shape is documented in README.md next to this script.
//
//   node census.mjs [--since "12 months ago"] [--threshold 0.5] [--min-shared 3]

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = { since: '12 months ago', threshold: 0.5, minShared: 3 };
// A commit touching more files than this is a sweep (rename, format, bump), not a coupling signal.
const MAX_FILES_PER_COMMIT = 50;
const MAX_BYTES = 1_000_000;

const MANIFEST_NAMES = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'pyproject.toml']);
const MANIFEST_EXTS = new Set(['.csproj', '.sln']);
const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const SOURCE_ROOTS = ['src', 'app', 'apps', 'lib', 'packages', 'services'];
// Receivers whose `.get('/x', ...)` is an outgoing request, not a route registration.
const HTTP_CLIENTS = new Set(['axios', 'http', 'https', 'httpClient', 'client', 'fetcher', 'ky', 'got', 'request', 'superagent', 'supertest']);
// A run of C# attributes, allowing string arguments and array types like `typeof(User[])`.
const CS_ATTRIBUTES = String.raw`(?:\[(?:[^\[\]"]|"[^"]*"|\[\])*\]\s*)*`;

// Code-unit order, not localeCompare: the output must not depend on the machine's collation.
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Tracked plus untracked-but-not-ignored files, so gitignored paths never reach a detector. */
function listFiles(root) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort(byText);
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

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

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

/** The pattern whose first non-empty group is an env var name in this kind of file, or null. */
function envPatternFor(path) {
  if (posix.basename(path) === '.env.example') return /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm;
  const ext = posix.extname(path);
  if (JS_EXTS.has(ext)) return /process\.env(?:\.([A-Za-z_]\w*)|\[\s*['"`]([A-Za-z_]\w*)['"`]\s*\])/g;
  if (ext === '.cs') return /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/g;
  return null;
}

/** The route a Next.js app-router or pages/api file serves: route groups `(x)` add no segment. */
function nextRoute(path) {
  const app = path.match(/(?:^|\/)app\/((?:.*\/)?)route\.[cm]?[jt]sx?$/);
  if (app) {
    const segments = app[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s));
    return { router: 'app', route: `/${segments.join('/')}` };
  }
  const pages = path.match(/(?:^|\/)pages\/api\/(.*)\.[cm]?[jt]sx?$/);
  if (pages) return { router: 'pages', route: `/api/${pages[1]}`.replace(/\/index$/, '') };
  return null;
}

function jsEntrypoints(path, text) {
  const found = [];
  const next = nextRoute(path);
  if (next?.router === 'app') {
    const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+(${HTTP_METHODS.join('|')})\\b`, 'g');
    const methods = [...new Set([...text.matchAll(exported)].map((m) => m[1]))];
    for (const method of methods) found.push({ kind: 'http-route', path, method, route: next.route });
    if (methods.length === 0) found.push({ kind: 'http-route', path, route: next.route });
    return found;
  }
  if (next?.router === 'pages') return [{ kind: 'http-route', path, route: next.route }];

  // Express, Hono and Fastify share `receiver.method('/path', handler)`; a chained Hono
  // registration has `)` as its receiver. The leading slash keeps Map.get('key') out, and
  // the required handler argument keeps a bare client call like fetch-style `.get('/x')` out.
  const call = /(?:\b(\w+)|\))\s*\.(get|post|put|patch|delete|head|options|all)\(\s*(['"`])(\/[^'"`]*)\3\s*,/g;
  for (const m of text.matchAll(call)) {
    if (HTTP_CLIENTS.has(m[1])) continue;
    found.push({ kind: 'http-route', path, line: lineOf(text, m.index + m[0].length), method: m[2].toUpperCase(), route: m[4] });
  }
  for (const m of text.matchAll(/\.route\(\s*\{([^}]*)\}/g)) {
    const method = m[1].match(/\bmethod:\s*['"`](\w+)['"`]/)?.[1];
    const url = m[1].match(/\burl:\s*['"`]([^'"`]+)['"`]/)?.[1];
    if (method && url) found.push({ kind: 'http-route', path, line: lineOf(text, m.index), method: method.toUpperCase(), route: url });
  }
  return found;
}

function binEntrypoints(path, text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return [];
  }
  const dir = posix.dirname(path);
  const bins = typeof pkg.bin === 'string' ? { [pkg.name ?? posix.basename(dir)]: pkg.bin } : (pkg.bin ?? {});
  return Object.entries(bins).map(([symbol, target]) => ({
    kind: 'bin',
    path: posix.normalize(posix.join(dir, target)),
    symbol,
  }));
}

function joinRoute(prefix, template, controller) {
  const route = template.startsWith('/') || template.startsWith('~/')
    ? template.replace(/^~/, '')
    : [prefix, template].filter(Boolean).join('/');
  return `/${route.replace(/^\/+/, '')}`.replace(/\[controller\]/gi, controller).replace(/\/+$/, '') || '/';
}

const routeTemplateIn = (attributes) => attributes.match(/\[Route\(\s*"([^"]*)"/)?.[1];

/** Each class declaration with the route prefix from its own attributes, in source order. */
function csClasses(text) {
  const decl = new RegExp(`(${CS_ATTRIBUTES})(?:(?:public|internal|private|protected|sealed|abstract|static|partial)\\s+)*class\\s+(\\w+)`, 'g');
  return [...text.matchAll(decl)].map((m) => ({
    index: m.index,
    prefix: routeTemplateIn(m[1]) ?? '',
    controller: m[2].replace(/Controller$/, ''),
  }));
}

function dotnetEntrypoints(path, text) {
  const found = [];
  if (posix.basename(path) === 'Program.cs') found.push({ kind: 'program', path, symbol: 'Program' });

  const classes = csClasses(text);
  const attributesBefore = new RegExp(`(${CS_ATTRIBUTES})$`);
  const attributesAfter = new RegExp(`^\\s*(${CS_ATTRIBUTES})[^(;{=]*?\\b(\\w+)\\s*\\(`);
  for (const m of text.matchAll(/\[Http(Get|Post|Put|Patch|Delete|Head|Options)(?:\(([^)]*)\))?\]/g)) {
    const owner = classes.findLast((c) => c.index < m.index) ?? { prefix: '', controller: '' };
    const before = text.slice(Math.max(0, m.index - 2000), m.index).match(attributesBefore)?.[1] ?? '';
    const after = text.slice(m.index + m[0].length).match(attributesAfter);
    const template = m[2]?.match(/^\s*"([^"]*)"/)?.[1] ?? routeTemplateIn(`${before}${after?.[1] ?? ''}`) ?? '';
    found.push({
      kind: 'http-route',
      path,
      line: lineOf(text, m.index),
      method: m[1].toUpperCase(),
      route: joinRoute(owner.prefix, template, owner.controller),
      ...(after && { symbol: after[2] }),
    });
  }

  for (const m of text.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) {
    found.push({ kind: 'http-route', path, line: lineOf(text, m.index), method: m[1].toUpperCase(), route: m[2] });
  }

  const hosted = /\bclass\s+(\w+)(?:<[^>]*>)?(?:\s*\([^)]*\))?\s*:\s*([^{;]+)/g;
  for (const m of text.matchAll(hosted)) {
    if (/\b(BackgroundService|IHostedService)\b/.test(m[2])) {
      found.push({ kind: 'hosted-service', path, line: lineOf(text, m.index), symbol: m[1] });
    }
  }
  return found;
}

function entrypointDetectorFor(path) {
  const ext = posix.extname(path);
  if (posix.basename(path) === 'package.json') return binEntrypoints;
  if (JS_EXTS.has(ext)) return jsEntrypoints;
  if (ext === '.cs') return dotnetEntrypoints;
  return null;
}

/** Commits in the window, each as the list of files it touched that still exist. */
function commitsSince(root, since, existing) {
  try {
    git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  } catch {
    return []; // no commits yet, so no history to count
  }
  const log = git(root, ['log', `--since=${since}`, '--no-merges', '--no-renames', '--name-only', '--format=%x00']);
  return log
    .split('\0')
    .map((chunk) => chunk.split('\n').map((l) => l.trim()).filter((l) => existing.has(l)))
    .filter((files) => files.length > 0);
}

function countChurn(commits) {
  const counts = new Map();
  for (const files of commits) for (const f of files) counts.set(f, (counts.get(f) ?? 0) + 1);
  return counts;
}

/**
 * Pairs whose shared commits are at least `minShared` and whose degree (shared over the
 * less-changed side's commits) is at least `threshold`. `keyOf` lifts files to the unit
 * being coupled, so the same rule pairs files and pairs slice directories.
 */
function coupledPairs(commits, { threshold, minShared }, keyOf = (f) => f) {
  const units = commits
    .filter((files) => files.length <= MAX_FILES_PER_COMMIT)
    .map((files) => [...new Set(files.map(keyOf).filter(Boolean))].sort(byText));
  const counts = countChurn(units);
  const shared = new Map();
  for (const keys of units) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const pair = `${keys[i]}\0${keys[j]}`;
        shared.set(pair, (shared.get(pair) ?? 0) + 1);
      }
    }
  }
  const pairs = [];
  for (const [pair, n] of shared) {
    const [a, b] = pair.split('\0');
    const degree = n / Math.min(counts.get(a), counts.get(b));
    if (n >= minShared && degree >= threshold) pairs.push({ a, b, shared: n, degree: Math.round(degree * 100) / 100 });
  }
  return pairs.sort((x, y) => y.shared - x.shared || byText(x.a, y.a) || byText(x.b, y.b));
}

/**
 * The directory a file's slice is keyed on: the first level under its source root, or the
 * root itself for files directly in it (a flat src/), else the top level.
 */
function sliceDirOf(roots) {
  return (path) => {
    const parts = path.split('/');
    if (parts.length < 2 || parts[0].startsWith('.')) return null;
    if (roots.has(parts[0])) return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    return roots.size === 0 ? parts[0] : null;
  };
}

function planSlices(files, commits, options) {
  const present = new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  const roots = new Set(SOURCE_ROOTS.filter((r) => present.has(r)));
  const dirOf = sliceDirOf(roots);

  const fileCount = new Map();
  for (const f of files) {
    const dir = dirOf(f);
    if (dir) fileCount.set(dir, (fileCount.get(dir) ?? 0) + 1);
  }

  const parent = new Map([...fileCount.keys()].map((d) => [d, d]));
  const find = (d) => (parent.get(d) === d ? d : find(parent.get(d)));
  for (const { a, b } of coupledPairs(commits, options, dirOf)) {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  }

  const groups = new Map();
  for (const dir of fileCount.keys()) {
    const key = find(dir);
    groups.set(key, [...(groups.get(key) ?? []), dir]);
  }
  return [...groups.values()]
    .map((dirs) => {
      const paths = dirs.sort(byText);
      return { name: paths.join('+'), paths, files: paths.reduce((n, p) => n + fileCount.get(p), 0) };
    })
    .sort((x, y) => y.files - x.files || byText(x.name, y.name));
}

/** The census of the git repo at `root`. Throws if `root` is not inside a git work tree. */
export function census(root = process.cwd(), opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  const top = git(root, ['rev-parse', '--show-toplevel']).trim();
  const files = listFiles(top);

  const entrypoints = [];
  const env = new Map();
  for (const path of files) {
    if (isTest(path)) continue;
    const detectEntrypoints = entrypointDetectorFor(path);
    const envPattern = envPatternFor(path);
    if (!detectEntrypoints && !envPattern) continue;
    const text = read(top, path);
    if (detectEntrypoints) entrypoints.push(...detectEntrypoints(path, text));
    for (const m of envPattern ? text.matchAll(envPattern) : []) {
      const name = m.slice(1).find(Boolean);
      env.set(name, new Set([...(env.get(name) ?? []), path]));
    }
  }

  const commits = commitsSince(top, options.since, new Set(files));
  const churn = [...countChurn(commits)]
    .map(([path, commitCount]) => ({ path, commits: commitCount }))
    .sort((x, y) => y.commits - x.commits || byText(x.path, y.path));

  return {
    manifests: files.filter(isManifest),
    entrypoints: entrypoints.sort((x, y) => byText(x.path, y.path) || (x.line ?? 0) - (y.line ?? 0)),
    schemas: files.filter(isSchema),
    envVars: [...env]
      .map(([name, paths]) => ({ name, files: [...paths].sort(byText) }))
      .sort((x, y) => byText(x.name, y.name)),
    churn,
    coChange: coupledPairs(commits, options),
    slicePlan: planSlices(files, commits, options),
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
