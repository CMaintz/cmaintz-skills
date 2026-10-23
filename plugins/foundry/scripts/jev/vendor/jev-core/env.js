import { createProvider } from './create-provider.js';
/**
 * Build a provider from the environment, or return null when no key is set so the
 * caller can fail open to its non-Jev behavior (Jev stays strictly opt-in).
 *
 * Reads: JEV_PROVIDER (typesafe | cloudflare, default typesafe), JEV_API_KEY, JEV_MODEL,
 * CLOUDFLARE_ACCOUNT_ID (cloudflare only), and TYPESAFE_AI_BASE_URL (self-host, proxy or mock).
 * Empty strings count as unset; any JEV_PROVIDER other than `cloudflare` means TypeSafe.
 */
export function providerFromEnv(env = globalThis.process?.env ?? {}) {
    const apiKey = env.JEV_API_KEY;
    const provider = env.JEV_PROVIDER === 'cloudflare' ? 'cloudflare' : 'typesafe';
    if (!apiKey || (provider === 'cloudflare' && !env.CLOUDFLARE_ACCOUNT_ID))
        return null;
    return createProvider({
        provider,
        apiKey,
        ...(env.JEV_MODEL ? { model: env.JEV_MODEL } : {}),
        ...(env.CLOUDFLARE_ACCOUNT_ID ? { accountId: env.CLOUDFLARE_ACCOUNT_ID } : {}),
        ...(env.TYPESAFE_AI_BASE_URL ? { baseUrl: env.TYPESAFE_AI_BASE_URL } : {}),
    });
}
