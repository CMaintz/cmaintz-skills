import { execFileSync } from 'node:child_process';

// Code-unit order, not localeCompare: the output must not depend on the machine's collation.
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function git(root, args, input) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}
