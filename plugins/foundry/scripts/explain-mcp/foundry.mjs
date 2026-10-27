// Runs the Foundry scripts the tools read from: the consumer's own provisioned
// foundry-explain (so the catalog matches the gate version that repo runs) and this
// plugin's foundry-loop-report. Read-only: nothing here runs a verb.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOP_REPORT = join(dirname(fileURLToPath(import.meta.url)), '..', 'foundry-loop-report');
const PYTHONS = ['python3', 'python'];

// The repo's environment as its gate sees it: mise puts the cached Foundry scripts on
// PATH and sets FOUNDRY_TELEMETRY. The server's own FOUNDRY_TELEMETRY may be another
// checkout's (Claude Code started from a mise shell), so it never leaks into a repo's
// answer. The templates build PATH from {{env.HOME}}, which a Windows process started
// outside Git Bash lacks, and mise would refuse the whole config without it.
export function miseEnv(repo, base = process.env) {
  const env = { HOME: homedir(), ...base };
  delete env.FOUNDRY_TELEMETRY;
  try {
    const out = execFileSync('mise', ['env', '--json'], {
      cwd: repo, env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ...env, ...JSON.parse(out) };
  } catch (err) {
    if (err.code === 'ENOENT') return env; // no mise: the repo's PATH is the server's
    throw new Error(`mise env failed in ${repo} (an untrusted worktree? run \`mise trust\`): ${err.stderr ?? err.message}`);
  }
}

export function findOnPath(name, env) {
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    const candidate = join(dir, name);
    if (dir && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// The first python that can import `probe`. Windows' python3 is often a Store stub, and
// foundry-explain needs tomllib (3.11+), so a bare "python3 exists" is not enough.
export function findPython(env, probe) {
  for (const py of PYTHONS) {
    try {
      execFileSync(py, ['-c', `import ${probe}`], { env, stdio: 'ignore', timeout: 20000 });
      return py;
    } catch {
      // try the next name
    }
  }
  throw new Error(`no python on PATH can import ${probe}`);
}

// Output travels on stdin, never argv: a verb log easily passes Windows' 32k command line.
export function runPython(env, probe, script, args, input = '') {
  const py = findPython(env, probe);
  try {
    return { ok: true, out: execFileSync(py, [script, ...args], { env, input, encoding: 'utf8', timeout: 60000 }) };
  } catch (err) {
    if (typeof err.status !== 'number') throw err;
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

export function explainScript(env) {
  const script = findOnPath('foundry-explain', env);
  if (!script) {
    throw new Error(
      'foundry-explain is not provisioned in this repo. It ships with Foundry\'s setup:foundry-scripts ' +
        'from the release that adds the rule catalog; bump FOUNDRY_SCRIPTS_REF and run `mise install`.',
    );
  }
  return script;
}

export function runExplain(env, args, input) {
  return runPython(env, 'tomllib', explainScript(env), ['--json', ...args], input);
}

export function runLoopReport(env, repo) {
  const telemetry = env.FOUNDRY_TELEMETRY || join(repo, '.foundry', 'telemetry.jsonl');
  const { ok, out } = runPython(env, 'json', LOOP_REPORT, ['--json', telemetry]);
  if (!ok) throw new Error(out);
  return JSON.parse(out);
}
