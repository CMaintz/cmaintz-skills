/** In-memory TTL cache with a size cap. Reads refresh recency; expired entries are dropped on read. */
export function createTtlCache(opts = {}) {
    const ttlMs = opts.ttlMs ?? 60_000;
    const max = opts.max ?? 1000;
    const store = new Map();
    return {
        get(key) {
            const hit = store.get(key);
            if (!hit)
                return undefined;
            store.delete(key);
            if (hit.expires <= Date.now())
                return undefined;
            store.set(key, hit); // refresh recency
            return hit.value;
        },
        set(key, value) {
            store.delete(key);
            if (store.size >= max)
                store.delete(store.keys().next().value);
            store.set(key, { value, expires: Date.now() + ttlMs });
        },
    };
}
