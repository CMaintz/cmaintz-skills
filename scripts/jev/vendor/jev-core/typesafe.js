import { postJson } from './http.js';
import { parseJevResponse } from './validate.js';
/**
 * TypeSafe first-party adapter.
 *
 * Verified against https://docs.typesafe.ai/api (2026-09):
 *   POST https://api.typesafe.ai/v1/systemone
 *   body:     { model, state, questions }
 *   response: { model, answers, usage }
 *   auth:     Authorization: Bearer {TYPESAFE_API_KEY}
 *
 * The official Python/JS SDKs are the eventual preferred path; this raw adapter keeps the
 * Action dependency-light. `postJson` applies the docs' recommended 429/529 backoff and a timeout;
 * `parseJevResponse` validates the answers against the questions asked.
 */
export class TypeSafeProvider {
    apiKey;
    model;
    baseUrl;
    constructor(apiKey, model = 'jev-latest', baseUrl = 'https://api.typesafe.ai/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }
    async evaluate(req, opts = {}) {
        const json = await postJson(`${this.baseUrl}/systemone`, { Authorization: `Bearer ${this.apiKey}` }, { model: this.model, state: req.state, questions: req.questions }, opts);
        return parseJevResponse(json, req.questions);
    }
}
