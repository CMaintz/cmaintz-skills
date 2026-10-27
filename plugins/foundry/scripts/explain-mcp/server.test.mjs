// The MCP server end to end over an in-memory transport: the real SDK, the real
// foundry-loop-report, and a stand-in foundry-explain that honours its CLI contract
// (`--json <id>`, `--json --match` on stdin), since the real one lives in the consumer's
// Foundry cache, not here.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { loadDeps } from './deps.mjs';
import { createServer } from './tools.mjs';

const FAKE_EXPLAIN = `import json, sys
args = [a for a in sys.argv[1:] if a != "--json"]
if args == ["--match"]:
    data = sys.stdin.read()
    hits = [{"id": "eslint:max-len", "why": "w", "bytes": len(data)}] if "max-len" in data else []
    print(json.dumps(hits))
elif args == ["eslint:max-len"]:
    print(json.dumps({"id": "eslint:max-len", "why": "line length", "suppressible": "with-label"}))
else:
    print(f"foundry-explain: no catalog entry for {args[0]!r}.", file=sys.stderr)
    sys.exit(1)
`;

function fixtureRepo({ explain = true, rows = [] } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'fx-mcp-'));
  const cache = join(repo, 'cache');
  mkdirSync(cache);
  if (explain) writeFileSync(join(cache, 'foundry-explain'), FAKE_EXPLAIN);
  mkdirSync(join(repo, '.foundry'));
  writeFileSync(join(repo, '.foundry', 'telemetry.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'));
  // What `mise env` would hand back: the Foundry cache on PATH, no FOUNDRY_TELEMETRY.
  const env = { ...process.env, PATH: `${cache}${delimiter}${process.env.PATH}`, FOUNDRY_TELEMETRY: '' };
  return { repo, env: () => env };
}

async function connect(ctx) {
  const deps = loadDeps();
  const { Client } = deps.require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = deps.require('@modelcontextprotocol/sdk/inMemory.js');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(deps, ctx).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

async function call(ctx, name, args = {}) {
  const result = await (await connect(ctx)).callTool({ name, arguments: args });
  return { isError: result.isError === true, body: result.content[0].text };
}

test('exposes exactly the three read-only tools and no way to run the gate', async () => {
  const { tools } = await (await connect(fixtureRepo())).listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['explain_failure', 'explain_rule', 'gate_status']);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test('explain_rule returns the catalog entry', async () => {
  const r = await call(fixtureRepo(), 'explain_rule', { id: 'eslint:max-len' });
  assert.equal(r.isError, false);
  assert.equal(JSON.parse(r.body).suppressible, 'with-label');
});

test('explain_rule reports an unknown id as an error, not an empty answer', async () => {
  const r = await call(fixtureRepo(), 'explain_rule', { id: 'eslint:nope' });
  assert.equal(r.isError, true);
  assert.match(r.body, /no catalog entry/);
});

test('explain_failure sends a log larger than any command line on stdin', async () => {
  const output = `${'x'.repeat(40000)}\n  9:1  error  too long  max-len\n`;
  const r = await call(fixtureRepo(), 'explain_failure', { output });
  const [entry] = JSON.parse(r.body);
  assert.equal(entry.id, 'eslint:max-len');
  assert.ok(entry.bytes >= output.length - 2);
});

test('a repo without foundry-explain gets the provisioning hint as an error', async () => {
  const r = await call(fixtureRepo({ explain: false }), 'explain_rule', { id: 'eslint:max-len' });
  assert.equal(r.isError, true);
  assert.match(r.body, /not provisioned.*FOUNDRY_SCRIPTS_REF/s);
});

test('gate_status reports each verb by its own last run and flags the one that regressed', async () => {
  const rows = [
    { ms: 1, ts: 't1', verb: 'lint', exit: 1, duration_ms: 5 },
    { ms: 2, ts: 't2', verb: 'test', exit: 0, duration_ms: 5 },
    { ms: 3, ts: 't3', verb: 'lint', exit: 0, duration_ms: 5 },
    { ms: 4, ts: 't4', verb: 'test', exit: 2, duration_ms: 5, rules: ['coverage:floor'] },
  ];
  const status = JSON.parse((await call(fixtureRepo({ rows }), 'gate_status')).body);
  assert.equal(status.verbs.lint.last.exit, 0);
  assert.equal(status.verbs.test.last.exit, 2);
  assert.deepEqual(status.verbs.test.last.rules, ['coverage:floor']);
  assert.deepEqual(status.red, ['test']);
  assert.deepEqual(status.thrash, { test: 1 });
});

test('explain_rule refuses an id that foundry-explain would take for a flag', async () => {
  const r = await call(fixtureRepo(), 'explain_rule', { id: '--list' });
  assert.equal(r.isError, true);
  assert.match(r.body, /not a rule id/);
});
