// The three read-only tools. There is deliberately no tool that runs a verb: CONTRACT.md
// makes `mise run gate` the only authority, and the agent runs it itself. A thrown error
// (no foundry-explain, no python) reaches the client as an isError result with its message.
import { readFileSync } from 'node:fs';
import { miseEnv, runExplain, runLoopReport } from './foundry.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function text(value, isError = false) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) };
}

function explainRule(ctx, { id, repo }) {
  // foundry-explain would read a leading "-" as one of its flags and answer in plain text.
  if (id.startsWith('-')) return text(`not a rule id: ${id}`, true);
  const { ok, out } = runExplain(ctx.env(repo ?? ctx.repo), [id]);
  return ok ? text(JSON.parse(out)) : text(out, true);
}

function explainFailure(ctx, { output, repo }) {
  const { ok, out } = runExplain(ctx.env(repo ?? ctx.repo), ['--match'], output);
  if (!ok) return text(out, true);
  const entries = JSON.parse(out);
  return text(entries.length ? entries : 'No catalog rule matches this output.');
}

function gateStatus(ctx, { repo }) {
  const dir = repo ?? ctx.repo;
  const summary = runLoopReport(ctx.env(dir), dir);
  return text(summary.telemetry ? summary : 'No verb telemetry yet: run `mise run gate` once.');
}

const TOOLS = [
  {
    name: 'explain_rule',
    description: 'Why a Foundry gate rule exists, its sanctioned fix, and whether it may be suppressed.',
    input: (z) => ({ id: z.string().describe('Rule id as foundry-verb-wrap prints it, e.g. eslint:max-len') }),
    run: explainRule,
  },
  {
    name: 'explain_failure',
    description: "The catalog entries a failing verb's output (or a pasted CI log) points at.",
    input: (z) => ({ output: z.string().describe('The verb or CI output') }),
    run: explainFailure,
  },
  {
    name: 'gate_status',
    description: 'Last result per verb from .foundry/telemetry.jsonl, the still-red verbs, and any that ' +
      'passed then failed again (thrash). Reports past runs; it does not run the gate.',
    input: () => ({}),
    run: gateStatus,
  },
];

export function registerTools(server, z, ctx) {
  const repo = z.string().optional().describe('Repo directory (default: the project Claude Code opened)');
  for (const tool of TOOLS) {
    const config = { description: tool.description, inputSchema: { ...tool.input(z), repo }, annotations: READ_ONLY };
    server.registerTool(tool.name, config, (args) => tool.run(ctx, args));
  }
}

export function defaultContext(env = process.env) {
  return { repo: env.CLAUDE_PROJECT_DIR || process.cwd(), env: miseEnv };
}

export function createServer(deps, ctx) {
  const server = new deps.McpServer({ name: 'foundry', version: VERSION });
  registerTools(server, deps.z, ctx);
  return server;
}
