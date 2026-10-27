import { posix } from 'node:path';
import { lineOf } from './source.mjs';

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
// Receivers whose `.get('/x', ...)` is an outgoing request, not a route registration.
const HTTP_CLIENTS = new Set(['axios', 'http', 'https', 'httpClient', 'client', 'fetcher', 'ky', 'got', 'request', 'superagent', 'supertest']);

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

const CLOSERS = { '[': ']', '{': '}', '(': ')' };
const isQuote = (c) => c === "'" || c === '"' || c === '`';

function stringEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === text[i]) return j;
  }
  return text.length;
}

/** The index of the bracket closing the one at `open`, skipping brackets inside strings. */
function closing(text, open) {
  const expected = [];
  for (let i = open; i < text.length; i++) {
    if (isQuote(text[i])) {
      i = stringEnd(text, i);
    } else if (CLOSERS[text[i]]) {
      expected.push(CLOSERS[text[i]]);
    } else if (text[i] === expected.at(-1)) {
      expected.pop();
      if (expected.length === 0) return i;
    }
  }
  return text.length;
}

/**
 * The text inside the bracket at `open` with nested arrays and objects blanked to spaces, so
 * a key match finds only this level's keys and its index still lines up with `text`.
 */
function topLevel(text, open) {
  let out = '';
  for (let i = open + 1, end = closing(text, open); i < end; i++) {
    if (isQuote(text[i]) || text[i] === '[' || text[i] === '{') {
      const to = isQuote(text[i]) ? stringEnd(text, i) : closing(text, i);
      out += isQuote(text[i]) ? text.slice(i, to + 1) : text[i] + ' '.repeat(to - i - 1) + text[to];
      i = to;
    } else {
      out += text[i];
    }
  }
  return out;
}

/**
 * `text` with `//` and block comments blanked to spaces, keeping newlines so offsets and line
 * numbers still line up. A commented-out route is not a route, and an apostrophe in a comment
 * would otherwise open a string that swallows the routes after it.
 */
function withoutComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    let end = i;
    if (isQuote(text[i])) end = stringEnd(text, i);
    else if (text.startsWith('//', i)) end = text.indexOf('\n', i) - 1;
    else if (text.startsWith('/*', i)) end = text.indexOf('*/', i) + 1;
    if (end < i) end = text.length - 1;
    const span = text.slice(i, end + 1);
    out += end === i || isQuote(text[i]) ? span : span.replace(/[^\n]/g, ' ');
    i = end;
  }
  return out;
}

// What follows a lazy import's specifier: `).then((m) => m.X)`, `).then((m: any) => m.X)`,
// `).then(({ X }) => X)`, or `)).X` after `(await import(...))`.
const LAZY_EXPORT = /^\s*\)\s*(?:\)\s*\.(\w+)|\.then\(\s*(?:\(?\s*(\w+)(?:\s*:\s*\w+)?\s*\)?\s*=>\s*\2\.(\w+)|\(\s*\{\s*(\w+)\s*\}\s*\)\s*=>))/;

/**
 * Each route of an Angular `Routes` array, with its parents' paths joined in. A lazily
 * loaded route points at the file it imports, since that is where its code lives. An eager
 * `component`, or an import the census cannot resolve without the filesystem (an alias like
 * `@app/x`, or `./admin`, which may be a directory), points at the line declaring the route.
 * A redirect, or a path built from a template, is no entrypoint.
 */
function angularRoutes(path, text, open, prefix, found) {
  for (const object of topLevel(text, open).matchAll(/\{/g)) {
    const start = open + 1 + object.index;
    const body = topLevel(text, start);
    const segment = body.match(/\bpath:\s*(['"`])([^'"`]*)\1/)?.[2];
    if (segment?.includes('${')) continue;
    const route = `/${[prefix, segment].filter(Boolean).join('/')}`;
    const at = (index) => lineOf(text, start + 1 + index);
    const lazy = body.match(/\bload(?:Component|Children):[^,]*?\bimport\(\s*(['"`])([^'"`]+)\1/);
    const eager = body.match(/\bcomponent:\s*(\w+)/);
    if (lazy) {
      // From `text`, since `body` blanks the braces of `({ X }) => X`.
      const m = text.slice(start + 1 + lazy.index + lazy[0].length).match(LAZY_EXPORT);
      const symbol = m?.[1] ?? m?.[3] ?? m?.[4];
      // A relative name with a dot (landing.page, admin.routes) is a file; Angular is
      // TypeScript-only, so without an extension it is a .ts file.
      const file = /^\.\.?\//.test(lazy[2]) && posix.basename(lazy[2]).includes('.')
        ? posix.normalize(posix.join(posix.dirname(path), lazy[2])) + (/\.[cm]?[jt]sx?$/.test(lazy[2]) ? '' : '.ts')
        : null;
      const where = file ? { path: file } : { path, line: at(lazy.index) };
      found.push({ kind: 'ui-route', ...where, route, ...(symbol && { symbol }) });
    } else if (eager) {
      found.push({ kind: 'ui-route', path, line: at(eager.index), route, symbol: eager[1] });
    }
    const children = body.match(/\bchildren:\s*\[/);
    if (children) angularRoutes(path, text, start + children.index + children[0].length, route.slice(1), found);
  }
}

function jsEntrypoints(path, text) {
  const found = [];
  const code = withoutComments(text);
  for (const m of code.matchAll(/(?::\s*Routes\s*=|\bprovideRouter\(|\bRouterModule\.for(?:Root|Child)\()\s*\[/g)) {
    angularRoutes(path, code, m.index + m[0].length - 1, '', found);
  }
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

export const packageJson = {
  matches: (path) => posix.basename(path) === 'package.json',
  entrypoints: binEntrypoints,
  envPattern: null,
};

export const js = {
  matches: (path) => JS_EXTS.has(posix.extname(path)),
  entrypoints: jsEntrypoints,
  envPattern: /process\.env(?:\.([A-Za-z_]\w*)|\[\s*['"`]([A-Za-z_]\w*)['"`]\s*\])/g,
};
