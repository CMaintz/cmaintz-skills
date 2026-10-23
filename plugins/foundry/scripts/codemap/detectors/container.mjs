import { posix } from 'node:path';

/** Keys of every `environment:` block, in map or list form, plus `${VAR}` interpolations. */
function composeEnv(text) {
  const names = [];
  let block = null;
  for (const line of text.split('\n')) {
    const indent = line.match(/^\s*/)[0].length;
    if (block !== null && line.trim() && indent <= block) block = null;
    if (block !== null) {
      const name = line.match(/^\s*(?:-\s*)?["']?([A-Za-z_]\w*)\s*(?:[:=]|["']?$)/)?.[1];
      if (name) names.push(name);
    }
    if (/^\s*environment:\s*$/.test(line)) block = indent;
  }
  return [...names, ...[...text.matchAll(/\$\{([A-Za-z_]\w*)/g)].map((m) => m[1])];
}

/** `ARG` names and `ENV` keys, in both `ENV A=1 B=2` and the legacy `ENV A 1` form. */
function dockerfileEnv(text) {
  // A multi-key ENV usually continues over lines with a trailing backslash.
  const joined = text.replace(/\\\r?\n/g, ' ');
  const names = [...joined.matchAll(/^\s*ARG\s+([A-Za-z_]\w*)/gim)].map((m) => m[1]);
  for (const [, rest] of joined.matchAll(/^\s*ENV\s+(.+)$/gim)) {
    names.push(...(rest.includes('=')
      ? [...rest.matchAll(/(?:^|\s)([A-Za-z_]\w*)=/g)].map((m) => m[1])
      : [rest.split(/\s+/)[0]]));
  }
  return names;
}

export const compose = {
  matches: (path) => /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/.test(posix.basename(path)),
  entrypoints: () => [],
  envVars: (path, text) => composeEnv(text),
};

export const dockerfile = {
  matches: (path) => /^Dockerfile(?:\..+)?$|\.Dockerfile$/i.test(posix.basename(path)),
  entrypoints: () => [],
  envVars: (path, text) => dockerfileEnv(text),
};
