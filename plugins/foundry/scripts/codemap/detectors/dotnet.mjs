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

export const dotnet = {
  matches: (path) => posix.extname(path) === '.cs',
  entrypoints: dotnetEntrypoints,
  envPattern: /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/g,
};
