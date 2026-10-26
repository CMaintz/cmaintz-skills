import { posix } from 'node:path';

// Variables a shell sets or inherits on its own, which configure nothing in the program.
const SHELL_VARS = new Set([
  'BASH_SOURCE', 'BASH_VERSION', 'EUID', 'FUNCNAME', 'HOME', 'HOSTNAME', 'IFS', 'LANG', 'LC_ALL',
  'LINENO', 'OLDPWD', 'OPTARG', 'OPTIND', 'OSTYPE', 'PATH', 'PIPESTATUS', 'PPID', 'PWD', 'RANDOM',
  'REPLY', 'SECONDS', 'SHELL', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'UID', 'USER',
]);

/**
 * Upper-case variables a shell script reads but never sets. An assignment that defaults the
 * variable from itself (`FOO="${FOO:-1}"`) still counts as read, since the environment wins.
 */
function shellEnv(text) {
  // Single quotes do not expand, so `awk '{print $NF}'` names no variable.
  const code = text.replace(/^\s*#.*$/gm, '').replace(/'[^'\n]*'/g, "''");
  const set = new Set();
  // Assignments also follow `;` and sit inside case arms: `A=""; B=""`, `--x) B="$2" ;;`.
  for (const m of code.matchAll(/(?:^|[\s;&|()])(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Z_][A-Z0-9_]*)=([^;\n]*)/g)) {
    if (!new RegExp(String.raw`\$\{?${m[1]}\b`).test(m[2])) set.add(m[1]);
  }
  for (const m of code.matchAll(/\b(?:for|read(?:\s+-\w+)*)\s+([A-Z_][A-Z0-9_]*)\b/g)) set.add(m[1]);
  return [...code.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)/g)]
    .map((m) => m[1])
    .filter((name) => !set.has(name) && !SHELL_VARS.has(name));
}

const pythonEnv = (text) => [...text.matchAll(
  /os\.(?:environ\.get|getenv)\(\s*['"]([A-Za-z_]\w*)['"]|os\.environ\[\s*['"]([A-Za-z_]\w*)['"]\s*\]/g,
)].map((m) => m[1] ?? m[2]);

// An editor on Windows can save a byte-order mark ahead of the shebang; the file is still meant
// as a script.
const hasShebang = (text) => text.replace(/^\uFEFF/, '').startsWith('#!');

// A shell file without a shebang is sourced by another script, a library rather than a command.
export const shell = {
  matches: (path) => /\.(sh|bash)$/.test(path),
  entrypoints: (path, text) => (hasShebang(text) ? [{ kind: 'script', path, symbol: posix.basename(path) }] : []),
  envVars: (path, text) => shellEnv(text),
};

export const python = {
  matches: (path) => posix.extname(path) === '.py',
  entrypoints: () => [],
  envVars: (path, text) => pythonEnv(text),
};

// Git runs a hook by its file name, so a script named like one is a git hook, not a CLI.
const GIT_HOOKS = new Set([
  'applypatch-msg', 'commit-msg', 'post-checkout', 'post-commit', 'post-merge', 'post-rewrite',
  'pre-applypatch', 'pre-commit', 'pre-merge-commit', 'pre-push', 'pre-rebase', 'prepare-commit-msg',
]);

// An extensionless file is a script only by its shebang; a README-like file has none.
export const shebangScript = {
  matches: (path) => !posix.basename(path).includes('.'),
  entrypoints: (path, text) => {
    if (!hasShebang(text)) return [];
    const name = posix.basename(path);
    return [{ kind: GIT_HOOKS.has(name) ? 'git-hook' : 'script', path, symbol: name }];
  },
  envVars: (path, text) => {
    if (!hasShebang(text)) return [];
    const shebang = text.split('\n', 1)[0];
    if (/\bpython/.test(shebang)) return pythonEnv(text);
    if (/\b(?:ba|da|z|k)?sh\b/.test(shebang)) return shellEnv(text);
    return [];
  },
};
