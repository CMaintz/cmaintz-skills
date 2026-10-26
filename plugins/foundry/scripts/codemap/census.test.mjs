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
      '        users.MapPost("/", static async (CreateUser body) => Results.Created());',
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
    'POST /api/users -',
    'GET /api/users/{id:guid} -',
  ]);
});

test('Angular routes resolve to the component they load, with the paths of their parents', () => {
  const root = fixture([{
    'web/src/app/app.routes.ts': [
      "import { Routes } from '@angular/router';",
      'export const routes: Routes = [',
      "  { path: '', pathMatch: 'full', loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage) },",
      "  { path: 'u/:handle', title: 'A {braced} title', component: PortfolioPage },",
      '  {',
      "    path: '',",
      '    canActivate: [authGuard],',
      '    children: [',
      "      { path: 'dashboard', loadComponent: () =>",
      "          import('./features/dashboard/dashboard.page').then(m => m.DashboardPage) },",
      "      { path: 'settings', children: [{ path: 'profile', component: ProfilePage }] },",
      '    ],',
      '  },',
      "  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },",
      "  { path: 'old', redirectTo: 'dashboard' },",
      "  { path: '**', loadComponent: () => import('./not-found.page') },",
      '];',
    ].join('\n'),
    'web/src/main.ts': "bootstrapApplication(App, { providers: [provideRouter([{ path: 'x', component: X }])] });\n",
    'web/src/app/more.routes.ts': [
      'export const more: Routes = [',
      "  // Can't be lazy: { path: 'legacy', component: LegacyPage },",
      "  /* { path: 'old', component: OldPage }, */",
      "  { path: 'alias', loadChildren: () => import('@app/alias/alias.routes').then((m) => m.ALIAS) },",
      "  { path: 'dir', loadChildren: () => import('./dir').then((m: any) => m.DIR_ROUTES) },",
      "  { path: 'await', loadComponent: async () => (await import('./await.page')).AwaitPage },",
      "  { path: 'destructured', loadComponent: () => import('./d.page').then(({ DPage }) => DPage) },",
      '];',
    ].join('\n'),
  }]);

  const routes = census(root).entrypoints
    .filter((e) => e.kind === 'ui-route')
    .map((e) => `${e.route} ${e.symbol ?? '-'} ${e.path}${e.line ? `:${e.line}` : ''}`);

  assert.deepEqual(routes, [
    '/admin ADMIN_ROUTES web/src/app/admin/admin.routes.ts',
    '/u/:handle PortfolioPage web/src/app/app.routes.ts:4',
    '/settings/profile ProfilePage web/src/app/app.routes.ts:11',
    '/await AwaitPage web/src/app/await.page.ts',
    '/destructured DPage web/src/app/d.page.ts',
    '/dashboard DashboardPage web/src/app/features/dashboard/dashboard.page.ts',
    '/ LandingPage web/src/app/features/landing/landing.page.ts',
    '/alias ALIAS web/src/app/more.routes.ts:4',
    '/dir DIR_ROUTES web/src/app/more.routes.ts:5',
    '/** - web/src/app/not-found.page.ts',
    '/x X web/src/main.ts:1',
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

test('vendored code, by linguist-vendored or a vendor directory, is not inventoried as the app', () => {
  const root = fixture([{
    '.gitattributes': 'scripts/jev/vendor-copy/** linguist-vendored\n',
    'scripts/jev/vendor-copy/package.json': '{"name":"copied","bin":"cli.js"}',
    'scripts/jev/vendor-copy/env.js': 'process.env.COPIED_KEY;\n',
    'vendor/lib/server.js': "app.get('/vendored', h);\n",
    'third_party/x/Program.cs': '',
    'src/server.js': "app.get('/own', h); process.env.OWN_KEY;\n",
  }]);

  const { manifests, entrypoints, envVars } = census(root);

  assert.deepEqual(manifests, []);
  assert.deepEqual(entrypoints.map((e) => e.route ?? e.symbol), ['/own']);
  assert.deepEqual(envVars.map((v) => v.name), ['OWN_KEY']);
});

test('runtime entrypoints: workflows, containers, compose services, IaC, agent hooks, git hooks and scripts', () => {
  const hooks = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}"/hooks/guard.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}"/hooks/stop.sh', timeout: 60 }] }],
    },
  };
  const root = fixture([{
    '.github/workflows/gate.yml': 'name: Gate\non: [push]\njobs: {}\n',
    '.github/workflows/deploy.yaml': 'on: push\njobs: {}\n',
    '.github/workflows/lint.yml': 'name: Lint # fast checks only\non: push\n',
    '.github/workflows/quoted.yml': "name: 'Release #2' # tagged\non: push\n",
    'scripts/deploy.sh': '#!/usr/bin/env bash\necho deploy\n',
    'scripts/lib.sh': 'log() { echo "$@"; }\n',
    Dockerfile: 'FROM node\nENTRYPOINT ["node", "server.js"]\n',
    'docker-compose.yml': 'services:\n  api:\n    image: x\n  db:\n    image: postgres\nvolumes:\n  data: {}\n',
    'deploy/compose.yaml': 'services:\n    web:\n        image: x\n# the queue worker\n    worker:\n        image: y\n',
    'infra/main.bicep': '',
    'infra/net.tf': '',
    'plugins/p/hooks/hooks.json': JSON.stringify(hooks),
    'plugins/p/hooks/guard.sh': '#!/bin/sh\n',
    'hooks/pre-push': '#!/bin/sh\nmise run gate\n',
    'scripts/release': '#!/usr/bin/env bash\necho release\n',
    LICENSE: 'MIT\n',
  }]);

  const seen = census(root).entrypoints.map((e) => `${e.kind} ${e.symbol ?? '-'} ${e.path}`);

  assert.deepEqual(seen.sort(), [
    'container - Dockerfile',
    'git-hook pre-push hooks/pre-push',
    'hook PreToolUse:Bash plugins/p/hooks/guard.sh',
    'hook Stop plugins/p/hooks/stop.sh',
    'iac - infra/main.bicep',
    'iac - infra/net.tf',
    'script deploy.sh scripts/deploy.sh',
    'script guard.sh plugins/p/hooks/guard.sh',
    'script release scripts/release',
    'service api docker-compose.yml',
    'service db docker-compose.yml',
    'service web deploy/compose.yaml',
    'service worker deploy/compose.yaml',
    'workflow Gate .github/workflows/gate.yml',
    'workflow Lint .github/workflows/lint.yml',
    'workflow Release #2 .github/workflows/quoted.yml',
    'workflow deploy .github/workflows/deploy.yaml',
  ]);
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

test('env vars are read from shell and Python scripts, compose files and Dockerfiles', () => {
  const root = fixture([{
    // POLL is assigned here and FILE is a loop variable, so neither comes from the environment.
    'scripts/ship.sh': [
      'root=$(pwd)',
      'POLL="${SHIP_POLL_SECONDS:-15}"',
      'BASE=""; BODY=""',
      'case "$1" in --body) BODY="$2" ;; esac',
      '# $COMMENTED is documentation, not a read',
      '[ -n "$CI" ] && exit 0',
      'echo "$HOME $root $POLL $BASE $BODY $1"',
      'for FILE in *; do :; done',
      "last=$(echo a b | awk '{print $NF}')",
    ].join('\n'),
    'bin/report': '#!/usr/bin/env python3\nimport os\np = os.environ.get("REPORT_PATH") or os.getenv(\'REPORT_DIR\')\nk = os.environ["TOKEN"]\n',
    'bin/notes': 'set $PRICE later\n',
    'docker-compose.yml': [
      'services:',
      '  api:',
      '    environment:',
      '      ConnectionStrings__Db: "Host=db"',
      '      Frontend__Url: ${FRONTEND_URL}',
      '    ports:',
      '      - "8080:8080"',
      '  worker:',
      '    environment:',
      '      - QUEUE_NAME=jobs',
      '      - "QUOTED_NAME=1"',
      '  cache:',
      '    environment:',
      '    - CACHE_TTL=60',
      '    image: redis',
    ].join('\n'),
    Dockerfile: 'FROM node\nARG BUILD_ENV\nENV PORT=8080 \\\n    NODE_ENV=production\nENV LEGACY_NAME value\n',
    'infra/main.bicep': [
      "secrets: [ { name: 'db-connection', value: conn } ]",
      'env: [',
      "  { name: 'ConnectionStrings__Db', secretRef: 'db-connection' }",
      '  {',
      "    name: 'Frontend__Url'",
      '    value: frontendUrl',
      '  }',
      ']',
      "tags: { name: 'not-an-env' }",
    ].join('\n'),
    'infra/app.tf': [
      'env {',
      '  name  = "TF_ENV_NAME"',
      '  value = "1"',
      '}',
      'app_settings = {',
      '  "TF_SETTING" = "x"',
      '  OTHER_SETTING = var.y',
      '}',
      'tags = { "Owner" = "me" }',
    ].join('\n'),
  }]);

  const { envVars } = census(root);

  assert.deepEqual(envVars.map((v) => `${v.name} ${v.files.join(',')}`), [
    'BUILD_ENV Dockerfile',
    'CACHE_TTL docker-compose.yml',
    'CI scripts/ship.sh',
    'ConnectionStrings__Db docker-compose.yml,infra/main.bicep',
    'FRONTEND_URL docker-compose.yml',
    'Frontend__Url docker-compose.yml,infra/main.bicep',
    'LEGACY_NAME Dockerfile',
    'NODE_ENV Dockerfile',
    'OTHER_SETTING infra/app.tf',
    'PORT Dockerfile',
    'QUEUE_NAME docker-compose.yml',
    'QUOTED_NAME docker-compose.yml',
    'REPORT_DIR bin/report',
    'REPORT_PATH bin/report',
    'SHIP_POLL_SECONDS scripts/ship.sh',
    'TF_ENV_NAME infra/app.tf',
    'TF_SETTING infra/app.tf',
    'TOKEN bin/report',
  ]);
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

test('feature folders that each hold the same layer folders stay sliced by feature', () => {
  const layers = ['controllers', 'services', 'repositories'];
  const root = fixture([Object.fromEntries(['billing', 'orders', 'users']
    .flatMap((feature) => layers.map((layer) => [`src/${feature}/${layer}/x.ts`, ''])))]);

  assert.deepEqual(census(root).slicePlan.map((s) => s.name), ['src/billing', 'src/orders', 'src/users']);
});

test('a folder name repeated across layer folders becomes one slice named after it, except generic names', () => {
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
