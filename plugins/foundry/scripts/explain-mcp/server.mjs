#!/usr/bin/env node
// foundry MCP server (stdio, read-only): explain_rule, explain_failure and gate_status over
// the consumer's rule catalog and verb telemetry. The plugin's .mcp.json starts it.
import { loadDeps } from './deps.mjs';
import { createServer, defaultContext } from './tools.mjs';

const deps = loadDeps();
await createServer(deps, defaultContext()).connect(new deps.StdioServerTransport());
