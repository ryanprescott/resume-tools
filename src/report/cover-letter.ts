import { z } from 'zod';
import { ask } from '../claude.js';
import { flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import type { JobSpec } from '../tailor/types.js';

const LetterSchema = z.object({ letter: z.string() });
const VerifySchema = z.object({ approved: z.boolean(), reason: z.string() });

const GROUNDING_SYSTEM_PROMPT =
  'You write cover letters strictly grounded in the candidate resume you are given. ' +
  'Every claim in the letter must be traceable to an existing resume bullet — never invent ' +
  'accomplishments, numbers, employers, or skills not present in the resume.';

const VERIFY_SYSTEM_PROMPT =
  'You are a strict fact-checker. You are given a resume and a cover letter drafted from it. ' +
  'Reject if the letter asserts any claim (numbers, technologies, scope, outcomes) not directly ' +
  'supported by the resume bullets. When in doubt, reject.';

export interface CoverLetterDraft {
  letter: string;
  approved: boolean;
  /** Why the grounding check rejected it; empty when approved. */
  reason: string;
}

/**
 * Returns the draft along with its verdict rather than throwing on a failed
 * check. A letter that overstates one clause is still worth having — you can
 * see the objection and fix that clause — and by the time this runs you have
 * already made every decision in the review, which a thrown error would discard.
 */
export async function generateCoverLetter(
  resume: Resume,
  job: JobSpec,
  company: string,
  signal?: AbortSignal,
): Promise<CoverLetterDraft> {
  const flat = flattenBullets(resume);
  const bulletLines = flat.map((b) => `- ${b.text} (${b.context})`).join('\n');

  const { letter } = await ask({
    prompt:
      `Write a concise cover letter for ${resume.contact.name} applying to the ${job.title} role ` +
      `at ${company}. Ground every claim in the resume bullets below; do not invent ` +
      'anything.\n\n' +
      `--- RESUME BULLETS ---\n${bulletLines}\n\n` +
      `--- JOB REQUIREMENTS ---\n${job.hardRequirements.map((r) => `- ${r}`).join('\n')}`,
    schema: LetterSchema,
    tools: [],
    effort: 'high',
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    signal,
  });

  const verdict = await ask({
    prompt:
      `--- RESUME BULLETS ---\n${bulletLines}\n\n--- COVER LETTER ---\n${letter}\n\n` +
      'Does the cover letter assert anything not supported by the resume bullets?',
    schema: VerifySchema,
    tools: [],
    effort: 'low',
    systemPrompt: VERIFY_SYSTEM_PROMPT,
    signal,
  });

  return { letter, approved: verdict.approved, reason: verdict.approved ? '' : verdict.reason };
}

/** The letter as written to disk, carrying its warning if it did not pass. */
export function renderCoverLetter(draft: CoverLetterDraft): string {
  if (draft.approved) return draft.letter;
  return (
    `> ⚠ **This draft did not pass the grounding check.**\n` +
    `>\n` +
    draft.reason
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n') +
    `\n>\n> Fix or cut the flagged claim before sending this.\n\n${draft.letter}`
  );
}
