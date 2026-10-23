import { stableStringify } from './stable-stringify.js';
import { createTtlCache } from './ttl-cache.js';
/**
 * Wrap a provider so identical requests (same state and questions, any key order) reuse
 * the last successful response until it expires. Only settled successes are cached:
 * failures and aborted calls are never shared between callers.
 */
export function withCache(provider, opts = {}) {
    const cache = 'get' in opts ? opts : createTtlCache(opts);
    return {
        async evaluate(req, evalOpts) {
            const key = stableStringify({ state: req.state, questions: req.questions });
            const hit = cache.get(key);
            if (hit)
                return hit;
            const res = await provider.evaluate(req, evalOpts);
            cache.set(key, res);
            return res;
        },
    };
}
/** Wrap a provider so every call first waits its turn on `limiter`. */
export function withRateLimit(provider, limiter) {
    return {
        async evaluate(req, evalOpts) {
            await limiter.acquire();
            return provider.evaluate(req, evalOpts);
        },
    };
}
