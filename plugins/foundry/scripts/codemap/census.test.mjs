import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { census } from './census.mjs';

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

// The developer's global git config (hooks, signing, autocrlf) must not leak into the fixtures.
// An empty file rather than os.devNull, which Git for Windows cannot open as a config file.
const emptyConfig = join(mkdtempSync(join(tmpdir(), 'census-cfg-')), 'gitconfig');
writeFileSync(emptyConfig, '');
roots.push(dirname(emptyConfig));
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };

function git(root, args, env = {}) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: root,
    env: { ...gitEnv, ...env },
    stdio: 'pipe',
  });
}

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A git repo with one commit per entry of `commits` (each a {path: content} map, plus an optional date). */
function fixture(commits) {
  const root = mkdtempSync(join(tmpdir(), 'census-'));
  roots.push(root);
  git(root, ['init', '-q']);
  for (const { date, ...files } of commits) {
    write(root, files);
    git(root, ['add', '-A']);
    const env = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
    git(root, ['commit', '-q', '-m', 'c'], env);
  }
  return root;
}

test('a TS fixture reports its Express, Next.js and bin entrypoints', () => {
  const root = fixture([
    {
      'package.json': JSON.stringify({ name: 'web', bin: { webctl: './bin/cli.js' } }),
      'bin/cli.js': '#!/usr/bin/env node\n',
      'src/server.ts': "const app = express();\napp.get('/health', ok);\nrouter.post(\"/users/:id\", save);\n",
      'app/(shop)/orders/[id]/route.ts': 'export async function GET() {}\nexport const DELETE = handler;\n',
      'pages/api/login/index.ts': 'export default function handler() {}\n',
      'src/server.test.ts': "app.get('/from-a-test', h); process.env.TEST_ONLY;\n",
      'src/hono.ts': "export const api = new Hono()\n  .get('/a', a)\n  .post('/b', b);\nfastify.route({ url: '/c', method: 'PUT', handler });\n",
      'src/client.ts': "await axios.get('/api/users');\nawait http.post('/login', body);\nawait store.get('/no-handler');\n",
    },
  ]);

  const { entrypoints, manifests, envVars } = census(root);

  assert.deepEqual(manifests, ['package.json']);
  assert.deepEqual(envVars, []);
  const seen = entrypoints.map((e) => `${e.kind} ${e.method ?? '-'} ${e.route ?? e.symbol} ${e.path}`);
  assert.deepEqual(seen.sort(), [
    'bin - webctl bin/cli.js',
    'http-route - /api/login pages/api/login/index.ts',
    'http-route DELETE /orders/[id] app/(shop)/orders/[id]/route.ts',
    'http-route GET /a src/hono.ts',
    'http-route GET /health src/server.ts',
    'http-route GET /orders/[id] app/(shop)/orders/[id]/route.ts',
    'http-route POST /b src/hono.ts',
    'http-route POST /users/:id src/server.ts',
    'http-route PUT /c src/hono.ts',
  ]);
  assert.deepEqual(
    entrypoints.find((e) => e.route === '/users/:id'),
    { kind: 'http-route', path: 'src/server.ts', line: 3, method: 'POST', route: '/users/:id' },
  );
});

test('a .NET fixture reports its controller actions, minimal-API endpoints and hosted services', () => {
  const root = fixture([
    {
      'src/Api/Api.csproj': '<Project />',
      'src/Api/Program.cs': 'var app = builder.Build();\napp.MapGet("/ping", () => "pong");\napp.MapPost("/orders", Create);\n',
      'src/Api/Controllers/UsersController.cs': [
        '[ApiController]',
        '[Route("api/[controller]")]',
        'public class UsersController : ControllerBase',
        '{',
        '    [HttpGet("{id}")]',
        '    [ProducesResponseType(typeof(User[]), 200)]',
        '    [Authorize(Roles = "admin")]',
        '    public async Task<IActionResult> GetById(int id) => Ok();',
        '    [HttpPost]',
        '    public IActionResult Create(User user) => Ok();',
        '    [HttpGet]',
        '    [Route("recent")]',
        '    public IActionResult Recent() => Ok();',
        '}',
      ].join('\n'),
      'src/Api/Controllers/HealthController.cs': [
        'public class HealthController : ControllerBase',
        '{',
        '    [HttpGet]',
        '    [Route("/healthz")]',
        '    public IActionResult Get() => Ok();',
        '}',
      ].join('\n'),
      'src/Api/Worker.cs': 'public sealed class Worker(ILogger<Worker> log) : BackgroundService { }\n',
    },
  ]);

  const { entrypoints } = census(root);
  const seen = entrypoints.map((e) => `${e.kind} ${e.method ?? '-'} ${e.route ?? e.symbol} ${e.path}`);

  assert.deepEqual(seen.sort(), [
    'hosted-service - Worker src/Api/Worker.cs',
    'http-route GET /api/Users/recent src/Api/Controllers/UsersController.cs',
    'http-route GET /api/Users/{id} src/Api/Controllers/UsersController.cs',
    'http-route GET /healthz src/Api/Controllers/HealthController.cs',
    'http-route GET /ping src/Api/Program.cs',
    'http-route POST /api/Users src/Api/Controllers/UsersController.cs',
    'http-route POST /orders src/Api/Program.cs',
    'program - Program src/Api/Program.cs',
  ]);
  assert.deepEqual(
    entrypoints.find((e) => e.route === '/api/Users/{id}'),
    { kind: 'http-route', path: 'src/Api/Controllers/UsersController.cs', line: 5, method: 'GET', route: '/api/Users/{id}', symbol: 'GetById' },
  );
  assert.equal(entrypoints.find((e) => e.route === '/api/Users/recent').symbol, 'Recent');
});

test('minimal-API routes carry their MapGroup prefix and a method-group handler as symbol', () => {
  const root = fixture([{
    'src/Api/Endpoints.cs': [
      'public static class Endpoints',
      '{',
      '    public static void Map(this IEndpointRouteBuilder app)',
      '    {',
      '        MapUsers(app.MapGroup("/api/users").RequireAuthorization());',
      '        var auth = app.MapGroup("/api/auth").WithTags("Auth");',
      '        auth.MapPost("/login", Login).WithSummary("Sign in.");',
      '        var admin = auth.MapGroup("/admin");',
      '        admin.MapDelete("/{id}", (Guid id) => Results.NoContent());',
      '        app.MapGet("/health", () => "ok");',
      '        app.MapGroup("/api/tags").MapGet("/", ListTags);',
      '        app.MapGroup("/api/admin").RequireAuthorization()',
      '            .MapPost("/reset", Reset);',
      '        app.MapGroup("/t/{tenant}").MapGet("/stats", Stats);',
      '    }',
      '',
      '    private static void MapUsers(RouteGroupBuilder users)',
      '    {',
      '        users.MapGet("/", ListUsers);',
      '        users.MapGet("/{id:guid}", async (Guid id) => Results.Ok());',
      '    }',
      '}',
    ].join('\n'),
  }]);

  const routes = census(root).entrypoints
    .filter((e) => e.kind === 'http-route')
    .map((e) => `${e.method} ${e.route} ${e.symbol ?? '-'}`);

  assert.deepEqual(routes, [
    'POST /api/auth/login Login',
    'DELETE /api/auth/admin/{id} -',
    'GET /health -',
    'GET /api/tags ListTags',
    'POST /api/admin/reset Reset',
    'GET /t/{tenant}/stats Stats',
    'GET /api/users ListUsers',
    'GET /api/users/{id:guid} -',
  ]);
});

test('a gitignored file is never reported, even when it would match every detector', () => {
  const root = fixture([
    {
      '.gitignore': 'node_modules/\nobj/\n',
      'index.js': 'process.env.KEPT;\n',
    },
  ]);
  write(root, {
    'node_modules/dep/package.json': '{"bin":"x.js"}',
    'node_modules/dep/server.js': "app.get('/leak', h); process.env.LEAKED;\n",
    'obj/Migrations/001.sql': 'create table t();',
  });

  const out = JSON.stringify(census(root));

  assert.doesNotMatch(out, /node_modules|obj\/|leak|LEAKED/i);
  assert.match(out, /KEPT/);
});

test('schemas and env vars are detected from their conventional sources', () => {
  const root = fixture([
    {
      '.env.example': 'export DB_URL=\n# COMMENTED=1\nPORT=3000\n',
      'prisma/schema.prisma': 'model User {}',
      'db/Migrations/20260101_Init.cs': '',
      'src/a.ts': "const k = process.env.API_KEY ?? process.env['REGION'];\n",
      'src/B.cs': 'var s = Environment.GetEnvironmentVariable("CONN_STRING");\n',
      'docs/notes.md': 'process.env.NOT_CODE',
    },
  ]);

  const { schemas, envVars } = census(root);

  assert.deepEqual(schemas, ['db/Migrations/20260101_Init.cs', 'prisma/schema.prisma']);
  assert.deepEqual(
    envVars.map((v) => v.name),
    ['API_KEY', 'CONN_STRING', 'DB_URL', 'PORT', 'REGION'],
  );
});

test('churn counts only commits inside the --since window', () => {
  const root = fixture([
    { 'a.js': '1', date: '2020-01-01T00:00:00Z' },
    { 'a.js': '2', 'b.js': '1' },
    { 'a.js': '3' },
  ]);

  const { churn } = census(root, { since: '1 year ago' });

  assert.deepEqual(churn, [
    { path: 'a.js', commits: 2 },
    { path: 'b.js', commits: 1 },
  ]);
});

test('directories that keep changing together merge into one slice; loosely coupled ones stay apart', () => {
  const together = Array.from({ length: 4 }, (_, i) => ({ 'src/orders/o.ts': `${i}`, 'src/billing/b.ts': `${i}` }));
  // auth and users share 3 commits, enough to count, but out of 8 each: degree 0.375, below 0.5.
  const loose = Array.from({ length: 8 }, (_, i) => (i < 3
    ? { 'src/auth/a.ts': `${i}`, 'src/users/u.ts': `${i}` }
    : { 'src/auth/a.ts': `${i}` }));
  const users = Array.from({ length: 5 }, (_, i) => ({ 'src/users/u.ts': `u${i}` }));
  const root = fixture([...together, ...loose, ...users]);

  const { slicePlan, coChange } = census(root);

  assert.deepEqual(
    slicePlan.map((s) => s.paths),
    [['src/billing', 'src/orders'], ['src/auth'], ['src/users']],
  );
  assert.deepEqual(coChange, [{ a: 'src/billing/b.ts', b: 'src/orders/o.ts', shared: 4, degree: 1 }]);
});

test('commits that sweep more than 50 files are not a coupling signal', () => {
  const filler = Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`f${i}.txt`, '']));
  const root = fixture(Array.from({ length: 3 }, (_, i) => ({ ...filler, 'a.ts': `${i}`, 'b.ts': `${i}`, [`x${i}.txt`]: '' })));

  assert.deepEqual(census(root).coChange, []);
});

test('files directly under a source root form a slice of their own, named apart from same-named siblings', () => {
  const root = fixture([{ 'src/a.ts': '', 'src/b.ts': '', 'src/api/x.ts': '', 'apps/api/y.ts': '', 'test/a.test.ts': '' }]);

  assert.deepEqual(
    census(root).slicePlan.map((s) => [s.name, s.paths, s.files]),
    [['src', ['src'], 2], ['apps/api', ['apps/api'], 1], ['src/api', ['src/api'], 1]],
  );
});

test('a source root nested below the top level slices by its own children', () => {
  const root = fixture([{ 'backend/src/Api/a.cs': '', 'backend/src/Domain/b.cs': '', 'backend/src/Domain/c.cs': '' }]);

  assert.deepEqual(
    census(root).slicePlan.map((s) => [s.name, s.paths]),
    [['backend/src/Domain', ['backend/src/Domain']], ['backend/src/Api', ['backend/src/Api']]],
  );
});

test('without a source root, a directory that only wraps one other is descended and its children slice', () => {
  const root = fixture([{
    'plugins/foundry/skills/ship.md': '',
    'plugins/foundry/skills/spec.md': '',
    'plugins/foundry/hooks/guard.sh': '',
    'plugins/foundry/scripts/report.mjs': '',
  }]);

  assert.deepEqual(
    census(root).slicePlan.map((s) => s.name),
    ['plugins/foundry/skills', 'plugins/foundry/hooks', 'plugins/foundry/scripts'],
  );
});

test('a source root inside one top-level directory does not stop wrapper descent in another', () => {
  const root = fixture([{
    'plugins/foundry/skills/ship.md': '',
    'plugins/foundry/skills/spec.md': '',
    'plugins/foundry/hooks/guard.sh': '',
    'plugins/foundry/scripts/lib/x.mjs': '',
    'web/src/app.ts': '',
  }]);

  assert.deepEqual(
    census(root).slicePlan.map((s) => s.name),
    ['plugins/foundry/skills', 'plugins/foundry/hooks', 'plugins/foundry/scripts', 'web/src'],
  );
});

test('a folder name repeated across layers becomes one slice named after it, except generic names', () => {
  const root = fixture([{
    'src/Api/Program.cs': '',
    'src/Api/Orders/OrdersEndpoint.cs': '',
    'src/Domain/Orders/Order.cs': '',
    'src/Domain/Users/User.cs': '',
    'src/Domain/Common/Entity.cs': '',
    'src/Application/Users/Register.cs': '',
    'src/Application/Common/Errors.cs': '',
    'web/src/orders/orders.page.ts': '',
  }]);

  assert.deepEqual(
    census(root).slicePlan.map((s) => [s.name, s.paths]),
    [
      ['orders', ['src/Api/Orders', 'src/Domain/Orders', 'web/src/orders']],
      ['users', ['src/Application/Users', 'src/Domain/Users']],
      ['src/Api', ['src/Api']],
      ['src/Application', ['src/Application']],
      ['src/Domain', ['src/Domain']],
    ],
  );
});

test('tests, docs, infra and dot-directories are reported as unsliced, never as slices', () => {
  const root = fixture([{
    'src/orders/o.ts': '',
    'tests/fixtures/src/x.ts': '',
    'backend/tests/Api.Tests/t.cs': '',
    'src/Api.Tests/Tests/t.cs': '',
    'backend/mise.toml': '',
    'docs/API.md': '',
    'infra/main.bicep': '',
    '.github/workflows/gate.yml': '',
    'README.md': '',
  }]);

  const { slicePlan, unsliced } = census(root);

  assert.deepEqual(slicePlan.map((s) => s.name), ['src/orders']);
  assert.deepEqual(unsliced, [
    { path: '.github', reason: 'config', files: 1 },
    { path: 'backend', reason: 'other', files: 1 },
    { path: 'backend/tests', reason: 'tests', files: 1 },
    { path: 'docs', reason: 'docs', files: 1 },
    { path: 'infra', reason: 'infra', files: 1 },
    { path: 'src/Api.Tests', reason: 'tests', files: 1 },
    { path: 'tests', reason: 'tests', files: 1 },
  ]);
});

test('a small directory that changes with two busy ones does not bridge them into one slice', () => {
  const busy = Array.from({ length: 10 }, (_, i) => ({ 'src/a/a.ts': `a${i}` }))
    .concat(Array.from({ length: 10 }, (_, i) => ({ 'src/b/b.ts': `b${i}` })));
  const bridge = Array.from({ length: 3 }, (_, i) => ({ 'src/a/a.ts': `x${i}`, 'src/b/b.ts': `x${i}`, 'src/c/c.ts': `${i}` }));
  const root = fixture([...busy, ...bridge]);

  const { slicePlan, coChange } = census(root);

  assert.deepEqual(slicePlan.map((s) => s.name), ['src/a', 'src/b', 'src/c']);
  // File-level coupling still measures against the less-changed side, so c's pairs show up.
  assert.ok(coChange.some((p) => p.a === 'src/a/a.ts' && p.b === 'src/c/c.ts'));
});

test('a repo with no commits yet still inventories its files', () => {
  const root = mkdtempSync(join(tmpdir(), 'census-'));
  roots.push(root);
  git(root, ['init', '-q']);
  write(root, { 'package.json': '{}' });

  const out = census(root);

  assert.deepEqual(out.manifests, ['package.json']);
  assert.deepEqual(out.churn, []);
});

test('the CLI prints the census, accepts --flag=value, and rejects a missing or non-numeric value', () => {
  const root = fixture([{ 'a.js': '' }]);
  const cli = (...args) => execFileSync(process.execPath, [join(import.meta.dirname, 'census.mjs'), ...args], {
    cwd: root,
    env: gitEnv,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.deepEqual(JSON.parse(cli('--since=1.year', '--threshold', '0.7')).churn, [{ path: 'a.js', commits: 1 }]);
  assert.throws(() => cli('--since'), /--since needs a value/);
  assert.throws(() => cli('--threshold', 'abc'), /--threshold must be a number/);
});
