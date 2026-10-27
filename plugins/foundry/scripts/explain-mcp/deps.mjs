// The MCP SDK and zod come from the plugin's package.json, installed either beside the
// plugin (Claude Code does this when it caches a marketplace plugin) or into
// ${CLAUDE_PLUGIN_DATA} by the mcp-deps SessionStart hook. ESM ignores NODE_PATH, so both
// roots are resolved explicitly through require, which loads the SDK's CommonJS build.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function requireFrom(root) {
  const req = createRequire(join(root, 'package.json'));
  try {
    req.resolve('@modelcontextprotocol/sdk/server/mcp.js');
    return req;
  } catch {
    return null;
  }
}

export function loadDeps(env = process.env) {
  const roots = [PLUGIN_ROOT, env.CLAUDE_PLUGIN_DATA].filter(Boolean);
  const req = roots.map(requireFrom).find(Boolean);
  if (!req) {
    throw new Error(`MCP SDK not installed under ${roots.join(' or ')}; start a new session so the ` +
      'mcp-deps hook installs it, or run `npm ci` in the plugin directory.');
  }
  return {
    McpServer: req('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
    StdioServerTransport: req('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport,
    z: req('zod').z,
    require: req,
  };
}
