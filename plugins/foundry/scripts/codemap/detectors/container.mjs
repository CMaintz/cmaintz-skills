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

/**
 * Each key directly under the top-level `services:` block. The service indent is taken from
 * the first one, since compose files indent by 2 or 4; comments never end the block.
 */
function composeServices(path, text) {
  const found = [];
  let inServices = false;
  let indent = null;
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      indent = null;
      continue;
    }
    const key = inServices && line.match(/^( +)([\w.-]+):/);
    if (!key) continue;
    indent ??= key[1].length;
    if (key[1].length === indent) found.push({ kind: 'service', path, line: i + 1, symbol: key[2] });
  }
  return found;
}

export const compose = {
  matches: (path) => /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/.test(posix.basename(path)),
  entrypoints: composeServices,
  envVars: (path, text) => composeEnv(text),
};

export const dockerfile = {
  matches: (path) => /^Dockerfile(?:\..+)?$|\.Dockerfile$/i.test(posix.basename(path)),
  entrypoints: (path) => [{ kind: 'container', path }],
  envVars: (path, text) => dockerfileEnv(text),
};
