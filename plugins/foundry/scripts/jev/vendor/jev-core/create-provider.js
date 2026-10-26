import { CloudflareProvider } from './cloudflare.js';
import { JevRequestError } from './questions.js';
import { TypeSafeProvider } from './typesafe.js';
/** TypeSafe model aliases and their Workers AI ids, so one config works on either backend. */
const CLOUDFLARE_MODEL_ALIASES = { 'jev-latest': 'typesafe/jev' };
/**
 * Build a provider from plain settings, for callers that read their own config (CLI flags,
 * Action inputs). Throws `JevRequestError` when a required setting is missing or the backend
 * is unknown. See `providerFromEnv` for the fail-open, environment-driven variant.
 */
export function createProvider(config) {
    const { provider = 'typesafe', apiKey, model, timeoutMs } = config;
    if (!apiKey)
        throw new JevRequestError('Jev provider needs an API key');
    if (provider === 'typesafe') {
        return new TypeSafeProvider({ apiKey, model: model || undefined, baseUrl: config.baseUrl || undefined, timeoutMs });
    }
    if (provider !== 'cloudflare')
        throw new JevRequestError(`unknown Jev provider "${String(provider)}"`);
    if (!config.accountId)
        throw new JevRequestError('Cloudflare Jev provider needs an account id');
    const { accountId } = config;
    return new CloudflareProvider({ accountId, apiToken: apiKey, model: cloudflareModel(model), timeoutMs });
}
function cloudflareModel(model) {
    if (!model)
        return undefined;
    return CLOUDFLARE_MODEL_ALIASES[model] ?? model;
}
