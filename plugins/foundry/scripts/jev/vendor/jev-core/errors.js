/** Base class for every error this package throws, so callers can catch Jev failures as one kind. */
export class JevError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'JevError';
    }
}
/** The provider answered with a non-2xx status (after retries, for 429/529). */
export class JevHttpError extends JevError {
    status;
    body;
    constructor(status, body) {
        super(`Jev request failed: ${status} ${body}`);
        this.status = status;
        this.body = body;
        this.name = 'JevHttpError';
    }
    /** True for the statuses TypeSafe's docs say to retry: 429 (rate limited) and 529 (overloaded). */
    get retryable() {
        return this.status === 429 || this.status === 529;
    }
}
/** A single attempt exceeded its timeout. */
export class JevTimeoutError extends JevError {
    timeoutMs;
    constructor(timeoutMs, options) {
        super(`Jev request timed out after ${timeoutMs} ms`, options);
        this.timeoutMs = timeoutMs;
        this.name = 'JevTimeoutError';
    }
}
/** The provider answered 2xx, but the body is not JSON or has no usable `answers` object. */
export class JevResponseError extends JevError {
    constructor(message, options) {
        super(message, options);
        this.name = 'JevResponseError';
    }
}
