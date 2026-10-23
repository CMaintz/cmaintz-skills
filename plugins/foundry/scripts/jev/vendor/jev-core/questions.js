import { JevError } from './errors.js';
/** Build a pick-one question. `options` maps each label to when to pick it. */
export const choice = (options, instructions = '') => ({
    type: 'choice',
    instructions,
    criteria: options,
});
/** Build a true/false question. `criteria` optionally describes what true and false mean. */
export const noul = (instructions, criteria) => ({
    type: 'noul',
    instructions,
    ...(criteria ? { criteria } : {}),
});
/** Build an ordered-rubric question. `levels` run low to high. */
export const score = (levels, instructions = '') => ({
    type: 'score',
    instructions,
    criteria: levels,
});
/** A request was rejected locally, before any network call, because it breaks a documented API limit. */
export class JevRequestError extends JevError {
    constructor(message) {
        super(message);
        this.name = 'JevRequestError';
    }
}
/** Limits from https://docs.typesafe.ai/api (checked 2026-10). */
export const QUESTION_LIMITS = { maxChoiceOptions: 255, minScoreLevels: 2, maxScoreLevels: 10 };
/**
 * Check questions against the documented API limits and throw a `JevRequestError` naming
 * every problem, so a bad batch fails fast instead of as a 422. Providers do not call this
 * themselves; call it where questions are built from user input.
 */
export function validateQuestions(questions) {
    const keys = Object.keys(questions);
    const problems = keys.length === 0 ? ['no questions'] : keys.flatMap((k) => questionProblems(k, questions[k]));
    if (problems.length > 0)
        throw new JevRequestError(`invalid Jev questions: ${problems.join('; ')}`);
}
function questionProblems(key, q) {
    const problems = q.instructions.trim() ? [] : [`${key}: empty instructions`];
    if (q.type === 'choice') {
        const n = Object.keys(q.criteria).length;
        if (n < 1 || n > QUESTION_LIMITS.maxChoiceOptions) {
            problems.push(`${key}: choice needs 1..${QUESTION_LIMITS.maxChoiceOptions} options, got ${n}`);
        }
    }
    else if (q.type === 'score') {
        const n = q.criteria.length;
        if (n < QUESTION_LIMITS.minScoreLevels || n > QUESTION_LIMITS.maxScoreLevels) {
            problems.push(`${key}: score needs ${QUESTION_LIMITS.minScoreLevels}..${QUESTION_LIMITS.maxScoreLevels} levels, got ${n}`);
        }
    }
    return problems;
}
