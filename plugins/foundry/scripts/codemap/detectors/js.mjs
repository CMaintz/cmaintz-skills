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
