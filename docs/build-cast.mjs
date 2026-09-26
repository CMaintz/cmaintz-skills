// Generates docs/demo.cast (asciinema v2) with correct ANSI escapes.
// Render: node docs/build-cast.mjs && npx svg-term-cli --in docs/demo.cast --out docs/demo.svg --window
import { writeFileSync } from 'node:fs';

const E = '\x1b';
const dim = (s) => `${E}[90m${s}${E}[0m`;
const cyan = (s) => `${E}[1;36m${s}${E}[0m`;
const hook = `${E}[1;33mhook${E}[0m`;
const ok = `${E}[1;32mok${E}[0m`;
const green = (s) => `${E}[32m${s}${E}[0m`;

const steps = [
  [0.4, dim('# an agent edits — the habits keep themselves') + '\r\n'],
  [0.9, cyan('edit') + ' src/Foo.ts\r\n'],
  [0.8, `  ${hook} auto-format   prettier --write src/Foo.ts       ${dim('[PostToolUse]')}\r\n`],
  [0.9, `  ${hook} habit-hooks   oversized-function -> coached      ${dim('[Stop]')}\r\n`],
  [1.0, '\r\n' + cyan('$ /foundry:ship') + '\r\n'],
  [0.7, `  fix ${ok}   gate ${ok}   fresh-context review ${ok}\r\n`],
  [0.8, `  ${green('->')} PR #42 opened\r\n`],
  [1.3, '\r\n' + dim('# deterministic gate + agent habits = standards that actually hold.') + '\r\n'],
  [1.4, ' '],
];

const header = { version: 2, width: 82, height: 14, env: { SHELL: '/bin/bash', TERM: 'xterm-256color' } };
let t = 0;
let out = JSON.stringify(header) + '\n';
for (const [d, text] of steps) {
  t += d;
  out += JSON.stringify([Number(t.toFixed(2)), 'o', text]) + '\n';
}
writeFileSync(new URL('./demo.cast', import.meta.url), out);
console.log('wrote docs/demo.cast');
