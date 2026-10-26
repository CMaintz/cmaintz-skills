import { posix } from 'node:path';

/** A GitHub Actions workflow, named by its `name:` or else its file. */
export const workflow = {
  matches: (path) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path),
  entrypoints: (path, text) => [{
    kind: 'workflow',
    path,
    // A `#` starts a comment only outside quotes: `name: CI # main` is CI, `name: 'Run #2'` keeps its #.
    symbol: text.match(/^name:\s*(?:(['"])(.+?)\1|([^#\n]*?))\s*(?:#.*)?$/m)?.slice(2).find(Boolean)
      ?? posix.basename(path).replace(/\.ya?ml$/, ''),
  }],
  envPattern: null,
};

/**
 * Env vars an IaC file sets on the app: Bicep `{ name: 'X', value | secretRef: ... }` entries
 * (container `env` and App Service `appSettings` alike), and Terraform `env { name = "X" }`
 * blocks and `app_settings` keys. A name must look like a variable, which keeps out secret
 * and resource names such as `db-connection`.
 */
function iacEnv(text) {
  const names = [...text.matchAll(/\{\s*name:\s*'([A-Za-z_]\w*)'\s*,?\s*(?:value|secretRef):/g)].map((m) => m[1]);
  names.push(...[...text.matchAll(/\benv\s*\{\s*name\s*=\s*"([A-Za-z_]\w*)"/g)].map((m) => m[1]));
  for (const [, settings] of text.matchAll(/\bapp_settings\s*=\s*\{([^}]*)\}/g)) {
    names.push(...[...settings.matchAll(/^\s*"?([A-Za-z_]\w*)"?\s*=/gm)].map((m) => m[1]));
  }
  return names;
}

export const iac = {
  matches: (path) => /\.(bicep|tf)$/.test(path),
  entrypoints: (path) => [{ kind: 'iac', path }],
  envVars: (path, text) => iacEnv(text),
};

/**
 * Claude Code hook registrations: one entry per command, keyed `Event` or `Event:matcher`, at
 * the script it runs. `${CLAUDE_PLUGIN_ROOT}` is the directory holding `hooks/`, like a bin
 * entry's path is resolved against its package.json.
 */
function agentHooks(path, text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return [];
  }
  const pluginRoot = posix.dirname(posix.dirname(path));
  const found = [];
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of group.hooks ?? []) {
        const script = hook.command?.match(/\$\{?CLAUDE_PLUGIN_ROOT\}?"?\/([^\s"']+)/)?.[1];
        found.push({
          kind: 'hook',
          path: script ? posix.join(pluginRoot, script) : path,
          symbol: group.matcher ? `${event}:${group.matcher}` : event,
        });
      }
    }
  }
  return found;
}

export const hooksJson = {
  matches: (path) => /(^|\/)hooks\/hooks\.json$/.test(path),
  entrypoints: agentHooks,
  envPattern: null,
};
