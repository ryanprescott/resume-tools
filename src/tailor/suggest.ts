import { z } from 'zod';
import { ask } from '../claude.js';
import { collectKnownIds, flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import type { Fact } from './facts.js';
import { SuggestionSchema, type Suggestion, type CoverageEntry, type JobSpec } from './types.js';

const SuggestResultSchema = z.object({ suggestions: z.array(SuggestionSchema) });

export function filterKnownSuggestions(
  suggestions: Suggestion[],
  knownIds: { bulletIds: ReadonlySet<string>; allIds: ReadonlySet<string> },
  factIds: ReadonlySet<string> = new Set(),
): Suggestion[] {
  return suggestions.filter((s) => {
    const sourcesReal = s.sourceIds.every((id) => knownIds.bulletIds.has(id) || factIds.has(id));
    if (!sourcesReal) return false;

    // A new bullet must be justified by something the user said. Sourced only
    // from existing bullets it would be padding — restating content the resume
    // already makes, which is exactly what the fabrication guard exists to stop.
    if (s.kind === 'add') {
      return knownIds.allIds.has(s.targetId) && s.sourceIds.some((id) => factIds.has(id));
    }
    return knownIds.allIds.has(s.targetId);
  });
}

/**
 * A run that is moving the resume into a different occupation. Same rule as
 * ever — nothing without an antecedent — but a different brief: in-scope
 * tailoring nudges, a pivot has to reframe nearly every bullet around what
 * transfers, and cut what does not.
 */
export interface Pivot {
  /** The occupation being moved into. */
  occupation: string;
  /** What the resume was written for, so the model knows the distance. */
  from: string;
}

export function pivotBrief(pivot: Pivot): string {
  return (
    `--- PIVOT ---\nThe candidate is moving into a different occupation: "${pivot.occupation}". ` +
    `This resume was written for "${pivot.from}". Tailor far more aggressively than usual:\n` +
    `- Rewrite every bullet that has transferable relevance so it leads with the skills, ` +
    `responsibilities and outcomes a ${pivot.occupation} hiring manager looks for, using that ` +
    `occupation's vocabulary wherever the underlying fact genuinely supports it.\n` +
    `- Rewrite the summary for the target occupation, grounded in the same material.\n` +
    `- Promote the entries and bullets that transfer best; drop bullets with no relevance.\n` +
    `- Never claim the candidate held a ${pivot.occupation} title, credential, license or duty ` +
    `the material does not state. Transferable is not the same as equivalent.\n\n`
  );
}

export async function suggest(
  resume: Resume,
  job: JobSpec,
  coverage: CoverageEntry[],
  facts: ReadonlyArray<Fact> = [],
  signal?: AbortSignal,
  pivot?: Pivot,
): Promise<Suggestion[]> {
  const flat = flattenBullets(resume);
  const bulletLines = flat.map((b) => `${b.id}: ${b.text} (${b.context})`).join('\n');
  const gaps = coverage.filter((c) => c.gap).map((c) => `- ${c.requirement}`);
  const covered = coverage
    .filter((c) => !c.gap)
    .map((c) => `- ${c.requirement} (evidence: ${c.evidenceIds.join(', ')})`);
  const factLines = facts.map((f) => `${f.id}: ${f.text}`).join('\n');

  const result = await ask({
    prompt:
      'You are proposing edits to tailor a resume to a job. Every suggestion MUST cite one or ' +
      'more existing ids in sourceIds that it derives from — never invent a claim with ' +
      'no antecedent in the material below. Rephrase, reorder, or reweight existing content; do ' +
      'not fabricate new facts, numbers, or skills.\n\n' +
      `--- JOB ---\ntitle: ${job.title}\nseniority: ${job.seniority}\ndomain: ${job.domain}\n\n` +
      (pivot ? pivotBrief(pivot) : '') +
      `--- RESUME BULLETS (id: text (context)) ---\n${bulletLines}\n\n` +
      `--- FACTS SUPPLIED BY THE CANDIDATE (id: text) ---\n${factLines || '(none)'}\n` +
      'These are true statements the candidate provided that are not yet in the resume. ' +
      'You may propose a new bullet for one using kind "add", with targetId set to the ' +
      'entry id (or an existing bullet id in the section) it belongs under, before left ' +
      'empty, and the fact id in sourceIds. Do not use "add" without a fact id in ' +
      'sourceIds, and do not restate a fact the resume already covers.\n\n' +
      `--- COVERED REQUIREMENTS ---\n${covered.join('\n') || '(none)'}\n\n` +
      `--- GAPS (no direct evidence) ---\n${gaps.join('\n') || '(none)'}\n\n` +
      'For each suggestion set targetId to the id being changed, kind to one of ' +
      'rewrite/reorder/promote/demote/drop/add, before/after to the bullet text before and ' +
      'after, sourceIds to the id(s) the content derives from (usually just targetId itself), ' +
      'rationale explaining the change, jdRef quoting the job requirement it serves, and ' +
      'confidence from 0 to 1.',
    schema: SuggestResultSchema,
    tools: [],
    effort: 'high',
    signal,
  });

  const knownIds = collectKnownIds(resume);
  const factIds = new Set(facts.map((f) => f.id));
  return filterKnownSuggestions(result.suggestions, knownIds, factIds).map((s) => ({
    ...s,
    origin: 'model' as const,
  }));
}
