import { byText, git } from './repo.mjs';

// A commit touching more files than this is a sweep (rename, format, bump), not a coupling signal.
const MAX_FILES_PER_COMMIT = 50;
const SOURCE_ROOTS = ['src', 'app', 'apps', 'lib', 'packages', 'services'];

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
 * less-changed side's commits) is at least `threshold`. `keyOf` lifts files to the unit
 * being coupled, so the same rule pairs files and pairs slice directories.
 */
export function coupledPairs(commits, { threshold, minShared }, keyOf = (f) => f) {
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

export function planSlices(files, commits, options) {
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
