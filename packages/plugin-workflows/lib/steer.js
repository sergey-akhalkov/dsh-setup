import { describeEvidence, resolveEvidenceText } from './evidence.js';
import { redactText } from './redact.js';
/**
 * The main-step steer. It names the step, the exact evidence contract, and the
 * workspace-relative path the verifier will check, using the same resolver, so
 * the model never has to guess where an artifact belongs.
 */
export const MAX_STEER_CHARS = 2000;
/** Render the bounded steer for one open main step. */
export function renderMainSteer(input) {
    const { run, definition, step, evidenceContext } = input;
    const header = `Workflow step "${step.title}" (${definition.id} / ${step.id}) is open.\nRun: ${run.id}; step: ${step.id}.`;
    const evidence = `Evidence required: ${step.evidence === undefined ? 'none' : describeEvidence(step.evidence, evidenceContext)}.`;
    const footer = [
        step.blockTurnClose === true
            ? 'The turn cannot close until the evidence verifies.'
            : 'Complete the evidence before the next step.',
        'A text claim is not evidence; the verifier reads the workspace.',
    ].join('\n');
    const fixed = header.length + evidence.length + footer.length + 2;
    const budget = MAX_STEER_CHARS - fixed - 1;
    if (budget < 0) {
        throw new Error(`the step "${step.id}" evidence contract is too long for a ${String(MAX_STEER_CHARS)}-character steer`);
    }
    const rawPrompt = step.prompt ?? '';
    const resolvedPrompt = resolveEvidenceText(rawPrompt, evidenceContext, undefined);
    const promptText = resolvedPrompt.ok ? resolvedPrompt.text : rawPrompt;
    // Redact first: redaction can expand text, so the bounded slice must come after it.
    const prompt = redactText(promptText).slice(0, budget);
    const text = [header, ...(prompt === '' ? [] : [prompt]), evidence, footer].join('\n');
    return text.length <= MAX_STEER_CHARS ? text : text.slice(0, MAX_STEER_CHARS);
}
/** Steer the root agent with the rendered text and return exactly what it saw. */
export function steerMain(target, input) {
    const text = renderMainSteer(input);
    target.steer(text);
    return text;
}
