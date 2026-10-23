import { postJson } from './http.js';
import { parseJevResponse } from './validate.js';
/**
 * Cloudflare Workers AI adapter. Model slug: `typesafe/jev`.
 *
 * Verified against https://developers.cloudflare.com/ai/models/typesafe/jev/ (2026-09):
 *   POST {base}/accounts/{account}/ai/run     - model goes in the BODY, not the path
 *   body:     { "model": "typesafe/jev", "input": { state, questions } }
 *   response: raw { model, answers, usage }    - no Cloudflare `result` envelope
 *   auth:     Authorization: Bearer {token}
 */
export class CloudflareProvider {
    accountId;
    apiToken;
    model;
    constructor(accountId, apiToken, model = 'typesafe/jev') {
        this.accountId = accountId;
        this.apiToken = apiToken;
        this.model = model;
    }
    async evaluate(req, opts = {}) {
        const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
        const json = await postJson(url, { Authorization: `Bearer ${this.apiToken}` }, { model: this.model, input: { state: req.state, questions: req.questions } }, opts);
        return parseJevResponse(json, req.questions);
    }
}
