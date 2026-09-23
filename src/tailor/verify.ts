import { ask } from '../claude.js';
import { flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import type { Fact } from './facts.js';
import { VerifyResultSchema, type Suggestion } from './types.js';

const VERIFY_SYSTEM_PROMPT =
  'You are a strict fact-checker for a resume-tailoring tool. You are given the ONLY source ' +
  'material that may justify a proposed bullet. Approve only if every factual claim in the ' +
  'proposed text (numbers, technologies, scope, outcomes) is directly supported by the source ' +
  'text — rephrasing and reweighting are fine, but any new fact, number, or claim not present ' +
  'in the source must be rejected. When in doubt, reject.';

export interface Rejection {
  suggestion: Suggestion;
  reason: string;
}

export interface VerifyOutcome {
  approved: Suggestion[];
  rejected: Rejection[];
}

/**
 * Each check is its own Claude session, and a pivot can propose three dozen
 * edits. All at once is a burst of subprocesses for no real gain in wall time.
 */
const CONCURRENCY = 6;

async function mapPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Rejections are returned rather than logged and dropped. A suggestion the
 * checker killed is information — it is often the checker being literal about a
 * claim you can in fact make — so the caller gets to show you the list.
 */
export async function verifySuggestions(
  resume: Resume,
  suggestions: Suggestion[],
  facts: ReadonlyArray<Fact> = [],
  signal?: AbortSignal,
): Promise<VerifyOutcome> {
  const byId = new Map<string, string>(flattenBullets(resume).map((b) => [b.id, b.text]));
  for (const fact of facts) byId.set(fact.id, `${fact.text} (stated by the candidate)`);

  const results = await mapPooled(suggestions, CONCURRENCY, async (s) => {
    // Text you typed is not the model's claim to make, so there is nothing
    // here to fact-check against a source.
    if (s.origin === 'user') return { suggestion: s, approved: true, reason: 'authored by the candidate' };
    // Removing a bullet asserts nothing; asked to check an empty "after",
    // the checker rejects it for having no text.
    if (s.kind === 'drop') return { suggestion: s, approved: true, reason: 'a removal makes no claim' };

    const sourceText = s.sourceIds.map((id) => `- ${byId.get(id) ?? '(unknown source)'}`).join('\n');
    const verdict = await ask({
      prompt:
        `--- SOURCE MATERIAL ---\n${sourceText}\n\n` +
        `--- PROPOSED TEXT ---\n${s.after}\n\n` +
        `Set targetId to "${s.targetId}". Does the proposed text assert anything not ` +
        'supported by the source material? Set approved accordingly and explain in reason.',
      schema: VerifyResultSchema,
      tools: [],
      effort: 'low',
      systemPrompt: VERIFY_SYSTEM_PROMPT,
      signal,
    });
    return { suggestion: s, approved: verdict.approved, reason: verdict.reason };
  });

  const approved: Suggestion[] = [];
  const rejected: Rejection[] = [];
  for (const result of results) {
    if (result.approved) approved.push(result.suggestion);
    else rejected.push({ suggestion: result.suggestion, reason: result.reason });
  }
  return { approved, rejected };
}
