import pc from 'picocolors';
import { describeLocation } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import { diffPair, field, panel, wrap } from '../ui/chrome.js';
import { pick, text, yesNo } from '../ui/prompts.js';
import type { Rejection } from './verify.js';
import type { Suggestion } from './types.js';

/**
 * The fabrication check runs in a fresh context and sees only the source bullets
 * for one suggestion, which is what makes it strict enough to be worth having.
 * It also means it rejects things it has no way to know are true. Those used to
 * go to stderr and vanish; here you get to look at them.
 *
 * An override is not a way to skip the check — it re-attributes the claim. You
 * confirm the wording, and the suggestion becomes yours, which is why it is then
 * exempt from re-verification.
 */
export async function reviewRejections(
  rejections: Rejection[],
  resume: Resume,
  prior: ReadonlyArray<Suggestion> = [],
): Promise<Suggestion[]> {
  if (rejections.length === 0) return [];
  const keptBefore = new Set(prior.map((s) => s.targetId));

  console.log('');
  console.log(
    wrap(
      `${rejections.length} suggestion(s) were cut for asserting something the source bullets ` +
        'do not support. The checker is deliberately literal and cannot see anything outside ' +
        'your resume, so some of these may be true — they just were not provable from the text.',
      2,
      pc.dim,
    ),
  );

  for (const { suggestion, reason } of rejections) {
    console.log('');
    console.log(
      panel({
        title: suggestion.targetId,
        right: pc.red('cut'),
        lines: [`${suggestion.kind} ${pc.dim('·')} ${pc.dim(describeLocation(resume, suggestion.targetId))}`],
      }),
    );
    console.log('');
    console.log(diffPair(suggestion.before, suggestion.after));
    console.log('');
    console.log(field('cut for', reason, pc.red));
  }

  console.log('');
  const kept = await pick(
    'Keep any of these anyway?',
    rejections.map(({ suggestion }, i) => ({
      name: `${suggestion.targetId}  ${suggestion.after.slice(0, 70)}${suggestion.after.length > 70 ? '…' : ''}`,
      value: i,
      checked: keptBefore.has(suggestion.targetId),
    })),
  );

  const restored: Suggestion[] = [];
  for (const index of kept) {
    const { suggestion } = rejections[index];
    console.log('');
    const confirmed = await text(`  ${pc.dim(suggestion.targetId)} final wording`, {
      default: suggestion.after,
      required: true,
    });
    const sure = await yesNo('  you can stand behind that in an interview?', { default: true });
    if (!sure) {
      console.log(pc.dim('  left out'));
      continue;
    }
    restored.push({
      ...suggestion,
      after: confirmed,
      rationale: `${suggestion.rationale} (kept by you over the fabrication check)`,
      origin: 'user',
    });
  }

  if (restored.length > 0) {
    console.log('');
    console.log(pc.cyan(`  ${restored.length} restored as your own claim(s)`));
  }
  return restored;
}
