/** The answer's value: the label for a choice, the number for a score, the probability for a noul. */
export function answerValue(answer) {
    if (answer.type === 'choice')
        return answer.choice;
    if (answer.type === 'score')
        return answer.score;
    return answer.noul;
}
/** Calibrated confidence for choice and score answers. Undefined for noul, which carries none. */
export function answerConfidence(answer) {
    return answer.type === 'noul' ? undefined : answer.confidence;
}
/**
 * The lowest confidence across the choice and score answers, or 1 when there are none.
 * A batch is only as confident as its least confident gated answer.
 */
export function minConfidence(answers) {
    let min = 1;
    for (const answer of Object.values(answers))
        min = Math.min(min, answerConfidence(answer) ?? 1);
    return min;
}
