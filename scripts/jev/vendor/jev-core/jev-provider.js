/**
 * The Jev provider port. jev-guard, jev-triage and jev-sort depend only on this
 * interface, never on a concrete backend (Cloudflare Workers AI vs. TypeSafe first-party).
 *
 * Shapes follow https://docs.typesafe.ai/api and Cloudflare's model page (checked 2026-09).
 */
export {};
