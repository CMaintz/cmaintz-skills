import { posix } from 'node:path';
import { lineOf } from './source.mjs';

// A run of C# attributes, allowing string arguments and array types like `typeof(User[])`.
const CS_ATTRIBUTES = String.raw`(?:\[(?:[^\[\]"]|"[^"]*"|\[\])*\]\s*)*`;

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

const joinPath = (...parts) => `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/**
 * A function from a minimal-API receiver and its offset to the route prefixes its MapGroup
 * chain adds. It follows the two shapes groups travel in: a local
 * (`var auth = app.MapGroup("/api/auth")`) and a method parameter
 * (`MapUsers(app.MapGroup("/api/users"))`, then `users.MapGet(...)` inside MapUsers). A helper
 * called with several groups yields one prefix per call. Anything else gets no prefix.
 */
function groupPrefixes(text) {
  const methods = [...text.matchAll(/(?:public|private|internal|protected|static)[^;{}()=]*?\b(\w+)\s*\(([^)]*)\)\s*(?:\{|=>)/g)]
    .map((m) => ({ index: m.index, name: m[1], params: m[2].split(',').map((p) => p.trim().split(/\s+/).at(-1)) }));
  const enclosing = (index) => methods.findLast((m) => m.index < index);
  const locals = [...text.matchAll(/\bvar\s+(\w+)\s*=\s*(\w+)\s*\.MapGroup\(\s*"([^"]*)"/g)]
    .map((m) => ({ index: m.index, name: m[1], parent: m[2], prefix: m[3] }));
  // A group passed as an argument, inline or through a variable.
  const groupArg = String.raw`\s*(?:(\w+)\s*\.MapGroup\(\s*"([^"]*)"|(\w+)\s*[,)])`;

  const resolve = (receiver, index, depth) => {
    if (depth > 8) return [''];
    const scope = enclosing(index);
    const local = locals.findLast((l) => l.name === receiver && l.index < index && enclosing(l.index) === scope);
    if (local) return resolve(local.parent, local.index, depth + 1).map((p) => joinPath(p, local.prefix));
    const position = scope?.params.indexOf(receiver) ?? -1;
    if (position === -1) return [''];
    const earlierArgs = String.raw`(?:[^,()]*,\s*)`.repeat(position);
    const calls = [...text.matchAll(new RegExp(String.raw`\b${scope.name}\(${earlierArgs}${groupArg}`, 'g'))];
    if (calls.length === 0) return [''];
    return calls.flatMap((c) => (c[1]
      ? resolve(c[1], c.index, depth + 1).map((p) => joinPath(p, c[2]))
      : resolve(c[3], c.index, depth + 1)));
  };
  return (receiver, index) => [...new Set(resolve(receiver, index, 0))];
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

  const prefixesOf = groupPrefixes(text);
  // Route templates hold braces (`/{id}`), so statement boundaries are found with strings blanked.
  const code = text.replace(/"[^"\n]*"/g, (s) => `"${' '.repeat(s.length - 2)}"`);
  for (const m of text.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"(?:\s*,\s*([A-Za-z_]\w*)\s*\))?/g)) {
    // The statement up to the call names the receiver and any MapGroup chained inline,
    // as in `app.MapGroup("/api").RequireAuthorization()` followed by `.MapPost(...)`.
    const start = Math.max(...[';', '{', '}'].map((c) => code.lastIndexOf(c, m.index)));
    const statement = text.slice(start + 1, m.index);
    const receiver = statement.match(/^\s*(?:return\s+)?(\w+)/)?.[1];
    const chained = [...statement.matchAll(/\.MapGroup\(\s*"([^"]*)"/g)].map((g) => g[1]);
    for (const prefix of receiver ? prefixesOf(receiver, m.index) : ['']) {
      found.push({
        kind: 'http-route',
        path,
        line: lineOf(text, m.index),
        method: m[1].toUpperCase(),
        route: joinPath(prefix, ...chained, m[2]),
        ...(m[3] && { symbol: m[3] }),
      });
    }
  }

  const hosted = /\bclass\s+(\w+)(?:<[^>]*>)?(?:\s*\([^)]*\))?\s*:\s*([^{;]+)/g;
  for (const m of text.matchAll(hosted)) {
    if (/\b(BackgroundService|IHostedService)\b/.test(m[2])) {
      found.push({ kind: 'hosted-service', path, line: lineOf(text, m.index), symbol: m[1] });
    }
  }
  return found;
}

export const dotnet = {
  matches: (path) => posix.extname(path) === '.cs',
  entrypoints: dotnetEntrypoints,
  envPattern: /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/g,
};
