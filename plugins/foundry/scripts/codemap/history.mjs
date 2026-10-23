import { byText, git } from './repo.mjs';

// A commit touching more files than this is a sweep (rename, format, bump), not a coupling signal.
const MAX_FILES_PER_COMMIT = 50;
const SOURCE_ROOTS = ['src', 'app', 'apps', 'lib', 'packages', 'services'];
// Also .NET's `Api.Tests` project folders.
const TEST_DIR = /^(__tests__|tests?|testing)$|\.tests?$/i;
const DOC_DIRS = new Set(['docs', 'doc', 'documentation']);
const INFRA_DIRS = new Set(['infra', 'deploy', 'deployment', 'ops', 'terraform', 'k8s', 'helm', 'charts']);
// Names that recur across layers without naming a domain, so they never gather into a slice.
const GENERIC_NAMES = new Set([
  'abstractions', 'assets', 'common', 'components', 'config', 'contracts', 'core', 'dto', 'dtos',
  'extensions', 'helpers', 'interfaces', 'internal', 'lib', 'migrations', 'models', 'properties',
  'shared', 'styles', 'types', 'util', 'utils',
]);

/** Commits in the window, each as the list of files it touched that still exist. */
export function commitsSince(root, since, existing) {
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

export function countChurn(commits) {
  const counts = new Map();
  for (const files of commits) for (const f of files) counts.set(f, (counts.get(f) ?? 0) + 1);
  return counts;
}

/**
 * Pairs whose shared commits are at least `minShared` and whose degree (shared over the
 * commits of the less-changed side, or of the more-changed side with `against: 'max'`) is at
 * least `threshold`. `keyOf` lifts files to the unit being coupled, so the same rule pairs
 * files and pairs slices.
 */
export function coupledPairs(commits, { threshold, minShared, against = 'min' }, keyOf = (f) => f) {
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
    const degree = n / Math[against](counts.get(a), counts.get(b));
    if (n >= minShared && degree >= threshold) pairs.push({ a, b, shared: n, degree: Math.round(degree * 100) / 100 });
  }
  return pairs.sort((x, y) => y.shared - x.shared || byText(x.a, y.a) || byText(x.b, y.b));
}

/**
 * Why a file belongs to no slice, as `{ path, reason }`, or null when it may be sliced. It runs
 * before root detection, so a fixture tree like `tests/fixtures/src` never reads as source.
 * A file at the repo root gets a null path: neither sliced nor reported.
 */
function exclusion(path) {
  const dirs = path.split('/').slice(0, -1);
  if (dirs.length === 0) return { path: null, reason: null };
  const upTo = (i) => dirs.slice(0, i + 1).join('/');
  const test = dirs.findIndex((d) => TEST_DIR.test(d));
  if (test !== -1) return { path: upTo(test), reason: 'tests' };
  const dot = dirs.findIndex((d) => d.startsWith('.'));
  if (dot !== -1) return { path: upTo(dot), reason: 'config' };
  if (DOC_DIRS.has(dirs[0])) return { path: dirs[0], reason: 'docs' };
  if (INFRA_DIRS.has(dirs[0])) return { path: dirs[0], reason: 'infra' };
  return null;
}

/** The slice key of a file under its innermost source root, or null when it has none. */
/**
 * A function from file to slice key, or to null when the file is outside every slice.
 *
 * Each top-level directory is first descended while it holds only one other directory.
 * From there, a chain of directly nested source roots (`frontend/src/app`) is followed and
 * the file keys on the first level below the last one. Only a chain counts: a `lib/` deep
 * inside `scripts/` is part of that unit, not a root that reshapes the repo around it.
 * Without a chain, a descended directory acts as a root itself (`plugins/foundry`), and an
 * undescended one is a slice of its own unless roots elsewhere show where the code lives.
 */
function sliceKeys(files) {
  const childDirs = new Map();
  const hasFiles = new Set();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (i === parts.length - 1) hasFiles.add(dir);
      else childDirs.set(dir, new Set([...(childDirs.get(dir) ?? []), parts[i]]));
    }
  }
  const descended = new Map();
  for (const top of new Set(files.map((f) => f.split('/')[0]))) {
    let dir = top;
    while (!hasFiles.has(dir) && childDirs.get(dir)?.size === 1) dir = `${dir}/${[...childDirs.get(dir)][0]}`;
    descended.set(top, dir);
  }

  const under = (root, parts) => parts.slice(0, parts.length > root + 2 ? root + 2 : root + 1).join('/');
  const chainKey = (parts) => {
    const start = descended.get(parts[0]).split('/').length - 1;
    // A root the descent stepped through still counts (`src` holding only `orders/`).
    let root = parts.slice(0, start + 1).findLastIndex((p) => SOURCE_ROOTS.includes(p));
    for (let i = start + 1; i < parts.length - 1 && SOURCE_ROOTS.includes(parts[i]); i++) root = i;
    return root === -1 ? null : under(root, parts);
  };

  const split = files.filter((f) => f.includes('/')).map((f) => f.split('/'));
  const topsWithRoot = new Set(split.filter((p) => chainKey(p)).map((p) => p[0]));
  return (path) => {
    const parts = path.split('/');
    if (parts.length < 2) return null;
    const key = chainKey(parts);
    if (key) return key;
    if (topsWithRoot.has(parts[0])) return null;
    const dir = descended.get(parts[0]);
    if (dir !== parts[0]) return under(dir.split('/').length - 1, parts);
    return topsWithRoot.size === 0 ? parts[0] : null;
  };
}

/**
 * Regroups a layered layout by domain: a non-generic subdirectory name found directly under
 * two or more slice keys becomes one slice named after it, joined by any key whose own last
 * segment matches. Subdirectories are read from each key's files, so a flat root never counts
 * the keys beside it as its own.
 */
function regroupByName(keyOf) {
  const under = new Map();
  for (const [file, key] of keyOf) {
    const rest = file.slice(key.length + 1).split('/');
    if (rest.length < 2) continue;
    const name = rest[0].toLowerCase();
    if (!GENERIC_NAMES.has(name)) under.set(name, new Set([...(under.get(name) ?? []), key]));
  }
  const recurring = new Set([...under].filter(([, keys]) => keys.size >= 2).map(([name]) => name));

  const groups = new Map();
  const regrouped = new Map();
  for (const [file, key] of keyOf) {
    const leaf = key.split('/').at(-1).toLowerCase();
    const rest = file.slice(key.length + 1).split('/');
    const [name, path] = recurring.has(leaf)
      ? [leaf, key]
      : rest.length > 1 && recurring.has(rest[0].toLowerCase())
        ? [rest[0].toLowerCase(), `${key}/${rest[0]}`]
        : [null, null];
    if (name) groups.set(name, new Set([...(groups.get(name) ?? []), path]));
    regrouped.set(file, name ?? key);
  }
  return { keyOf: regrouped, groups };
}

/**
 * The proposed slices, and the files left out of them grouped by directory and reason. Files
 * are keyed by `sliceKeys`, a layered layout is regrouped by repeated folder names, and slices
 * that keep changing together merge.
 */
export function planSlices(files, commits, options) {
  const unslicedCount = new Map();
  const leaveOut = (path, reason) => {
    const id = `${path}\0${reason}`;
    unslicedCount.set(id, (unslicedCount.get(id) ?? 0) + 1);
  };
  const candidates = [];
  for (const f of files) {
    const out = exclusion(f);
    if (!out) candidates.push(f);
    else if (out.path) leaveOut(out.path, out.reason);
  }

  const keyFor = sliceKeys(candidates);
  const initial = new Map();
  for (const f of candidates) {
    const key = keyFor(f);
    if (key) initial.set(f, key);
    else leaveOut(f.split('/')[0], 'other');
  }

  const { keyOf, groups } = regroupByName(initial);
  const fileCount = new Map();
  for (const key of keyOf.values()) fileCount.set(key, (fileCount.get(key) ?? 0) + 1);

  // Degree against the busier side: measured against the quieter one, a directory whose three
  // commits all touched two busy ones scores 1.0 against both and chains them into one slice.
  const parent = new Map([...fileCount.keys()].map((k) => [k, k]));
  const find = (k) => (parent.get(k) === k ? k : find(parent.get(k)));
  for (const { a, b } of coupledPairs(commits, { ...options, against: 'max' }, (f) => keyOf.get(f))) {
    parent.set(find(a), find(b));
  }

  const merged = new Map();
  for (const key of fileCount.keys()) merged.set(find(key), [...(merged.get(find(key)) ?? []), key]);
  const slices = [...merged.values()]
    .map((keys) => {
      const names = keys.sort(byText);
      const paths = names.flatMap((k) => (groups.has(k) ? [...groups.get(k)] : [k])).sort(byText);
      return { name: names.join('+'), paths, files: names.reduce((n, k) => n + fileCount.get(k), 0) };
    })
    .sort((x, y) => y.files - x.files || byText(x.name, y.name));

  const unsliced = [...unslicedCount]
    .map(([id, n]) => {
      const [path, reason] = id.split('\0');
      return { path, reason, files: n };
    })
    .sort((x, y) => byText(x.path, y.path) || byText(x.reason, y.reason));
  return { slices, unsliced };
}
