import { posix } from 'node:path';

export const dotenv = {
  matches: (path) => posix.basename(path) === '.env.example',
  entrypoints: () => [],
  envPattern: /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
};
