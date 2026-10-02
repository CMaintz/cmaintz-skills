// VENDORED from CMaintz/foundry:scripts/jev/client.mjs (canonical home). Kept in sync by backport discipline - edit there, then re-vendor here.
// The Jev provider port for Foundry's advisory layer. Lifted from jev-triage's
// adapters, verified against https://docs.typesafe.ai/api (2026-09).
//
// ADVISORY ONLY. Nothing here may be imported by a gate verb (lint/typecheck/test/
// audit) or by gate.yml / tier0.yml - ruleset_guard.py fails the build if it is.
// Jev routes where to spend expensive LLM effort; it never decides pass/fail.
//
// Zero dependencies; uses global fetch (Node 18+).

const RETRYABLE = new Set([429, 529]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST JSON with the docs' recommended exponential backoff on 429/529. */
export async function postJson(url, headers, body, maxAttempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`Jev request failed: ${res.status} ${await res.text()}`);
  }
}

/** TypeSafe first-party adapter: POST {baseUrl}/systemone, Bearer auth. */
export class TypeSafeProvider {
  constructor(apiKey, model = 'jev-latest', baseUrl = 'https://api.typesafe.ai/v1') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async evaluate({ state, questions }) {
    return postJson(
      `${this.baseUrl}/systemone`,
      { Authorization: `Bearer ${this.apiKey}` },
      { model: this.model, state, questions },
    );
  }
}

/** Cloudflare Workers AI adapter: model in the body, no `result` envelope. */
export class CloudflareProvider {
  constructor(accountId, apiToken, model = 'typesafe/jev') {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.model = model;
  }

  async evaluate({ state, questions }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
    return postJson(
      url,
      { Authorization: `Bearer ${this.apiToken}` },
      { model: this.model, input: { state, questions } },
    );
  }
}

/**
 * Build a provider from the environment, or return null when no key is set so
 * every caller fails open to current behavior (Jev is strictly opt-in).
 *
 * Reads: JEV_PROVIDER (typesafe|cloudflare), JEV_MODEL, JEV_API_KEY,
 * CLOUDFLARE_ACCOUNT_ID, and TYPESAFE_AI_BASE_URL (self-host / proxy / mock).
 */
export function providerFromEnv(env = process.env) {
  if ((env.JEV_PROVIDER ?? 'typesafe') === 'cloudflare') {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.JEV_API_KEY) return null;
    return new CloudflareProvider(env.CLOUDFLARE_ACCOUNT_ID, env.JEV_API_KEY, env.JEV_MODEL || undefined);
  }
  if (!env.JEV_API_KEY) return null;
  const baseUrl = env.TYPESAFE_AI_BASE_URL || 'https://api.typesafe.ai/v1';
  return new TypeSafeProvider(env.JEV_API_KEY, env.JEV_MODEL || 'jev-latest', baseUrl);
}
