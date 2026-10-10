/**
 * Paces acquisitions to at most `perMinute`, spacing them evenly. Combined with the
 * per-request 429/529 backoff in the provider, this keeps big jobs under the account's
 * rate limit (TypeSafe documents 40 req/s for jev; see docs.typesafe.ai/models).
 * `perMinute <= 0` disables it (no wait).
 */
export class RateLimiter {
    intervalMs;
    nextAt = 0;
    constructor(perMinute) {
        this.intervalMs = perMinute > 0 ? 60_000 / perMinute : 0;
    }
    async acquire() {
        if (this.intervalMs <= 0)
            return;
        const now = Date.now();
        const at = Math.max(now, this.nextAt);
        this.nextAt = at + this.intervalMs;
        const wait = at - now;
        if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
    }
}
