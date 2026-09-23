import pc from 'picocolors';
import { describeLocation, locate } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import { diffPair, field, meter, panel } from '../ui/chrome.js';
import { choose, text, Separator } from '../ui/prompts.js';
import type { FactStore } from './facts.js';
import type { Decision, Suggestion } from './types.js';

type Verdict = 'accept' | 'edit' | 'reject' | 'skip';

export interface Slot {
  suggestion: Suggestion;
  verdict?: Verdict;
  editedText?: string;
}

function tally(slots: Slot[]): string {
  const count = (v: Verdict): number => slots.filter((s) => s.verdict === v).length;
  const pending = slots.filter((s) => s.verdict === undefined).length;
  const parts = [
    pc.green(`✓ ${count('accept')}`),
    pc.cyan(`✎ ${count('edit')}`),
    pc.red(`✗ ${count('reject')}`),
    pc.dim(`— ${count('skip')}`),
  ];
  return pc.dim(`${parts.join('  ')}   ${pending} left`);
}

function show(slot: Slot, index: number, total: number, resume: Resume, store: FactStore): void {
  const s = slot.suggestion;
  const where = describeLocation(resume, s.targetId);
  const authored = s.origin === 'user';

  console.log('');
  console.log(
    panel({
      title: `Suggestion ${index + 1} of ${total}`,
      right: authored ? pc.cyan('yours') : `${pc.dim('confidence')} ${meter(s.confidence)}`,
      lines: [`${pc.bold(s.targetId)} ${pc.dim('·')} ${s.kind} ${pc.dim('·')} ${pc.dim(where)}`],
    }),
  );
  console.log('');
  console.log(diffPair(s.before, s.after));
  console.log('');
  if (s.rationale) console.log(field('why', s.rationale));
  if (s.jdRef) console.log(field('jd', `"${s.jdRef}"`, pc.italic));

  const sources = s.sourceIds
    .map((id) => {
      const fact = store.get(id);
      return fact ? `${id} ${pc.cyan('(yours)')}` : id;
    })
    .join(', ');
  const seal = authored ? pc.cyan('✓ your own words') : pc.green('✓ no new claims');
  console.log(field('source', `${sources}  ${seal}`));

  if (slot.verdict) console.log('\n' + pc.dim(`  previously: ${slot.verdict}`));
}

export interface ReviewResult {
  decisions: Decision[];
}

/** Identity of a suggestion across a re-run, for restoring earlier verdicts. */
function slotKey(s: Suggestion): string {
  return `${s.targetId}|${s.kind}|${s.after}`;
}

/**
 * Rebuild the review list, carrying over verdicts from a previous pass.
 *
 * Two things have to survive coming back to this stage: decisions you already
 * made about suggestions that are still on the list, and bullets you wrote
 * yourself, which exist *only* in the decision list and are in no regenerated
 * set of suggestions. A `skip` is not carried over — it was "not yet", not "no".
 */
export function seedSlots(
  suggestions: ReadonlyArray<Suggestion>,
  prior: ReadonlyArray<Decision>,
): Slot[] {
  const seeded = new Map(prior.map((d) => [slotKey(d.suggestion), d]));
  const slots: Slot[] = suggestions.map((suggestion) => {
    const previous = seeded.get(slotKey(suggestion));
    if (!previous || previous.action === 'skip') return { suggestion };
    return { suggestion, verdict: previous.action, editedText: previous.editedText };
  });

  for (const decision of prior) {
    if (decision.suggestion.origin !== 'user') continue;
    if (slots.some((slot) => slotKey(slot.suggestion) === slotKey(decision.suggestion))) continue;
    slots.push({
      suggestion: decision.suggestion,
      verdict: decision.action,
      editedText: decision.editedText,
    });
  }

  return slots;
}

/**
 * Walk the suggestions one at a time. Unlike the single-keypress loop this
 * replaces, a decision is not final: you can step back and change one, and the
 * running tally tells you where you are without having to remember.
 *
 * `prior` re-seeds verdicts when you come back to this stage from the
 * navigator. Reviewing eleven suggestions is the longest job in the run, and
 * losing it because you went back to correct the job title would make going
 * back something you avoid.
 */
export async function runReview(
  suggestions: Suggestion[],
  resume: Resume,
  store: FactStore,
  prior: ReadonlyArray<Decision> = [],
): Promise<ReviewResult> {
  const slots = seedSlots(suggestions, prior);

  if (slots.length === 0) {
    console.log(pc.dim('  no suggestions survived the fabrication check — nothing to review'));
    return { decisions: [] };
  }

  let index = 0;
  let quit = false;

  while (index < slots.length && !quit) {
    const slot = slots[index];
    console.log('\n' + tally(slots));
    show(slot, index, slots.length, resume, store);
    console.log('');

    const action = await choose<string>(
      'What do you want to do?',
      [
        { name: 'accept', value: 'accept', description: 'take the suggestion as written' },
        { name: 'edit …', value: 'edit', description: 'change the wording before accepting' },
        { name: 'reject', value: 'reject', description: 'keep the original bullet' },
        { name: 'add a bullet here instead', value: 'add', description: 'write something new in this entry' },
        new Separator(),
        ...(index > 0 ? [{ name: `back to #${index}`, value: 'back' }] : []),
        { name: 'skip for now', value: 'skip' },
        { name: 'stop here and apply what I have decided', value: 'quit' },
      ],
      { default: 'accept', pageSize: 12 },
    );

    if (action === 'back') {
      index -= 1;
      continue;
    }
    if (action === 'quit') {
      quit = true;
      break;
    }
    if (action === 'add') {
      await addBulletHere(slot.suggestion, resume, store, slots, index);
      continue;
    }
    if (action === 'edit') {
      const edited = await text('  bullet text', {
        default: slot.editedText ?? slot.suggestion.after,
        required: true,
      });
      slot.verdict = 'edit';
      slot.editedText = edited;
    } else {
      slot.verdict = action as Verdict;
    }
    index += 1;
  }

  const decisions: Decision[] = slots.map((slot) => ({
    suggestion: slot.suggestion,
    action: slot.verdict ?? 'skip',
    editedText: slot.editedText,
  }));

  console.log('\n' + tally(slots));
  return { decisions };
}

/**
 * Insert a bullet you wrote yourself, anchored to the entry you are looking at.
 * The text becomes a fact first, so it is citable, survives the run in
 * `facts.md`, and carries its own id into the variant.
 */
async function addBulletHere(
  context: Suggestion,
  resume: Resume,
  store: FactStore,
  slots: Slot[],
  index: number,
): Promise<void> {
  const at = locate(resume, context.targetId);
  const where = describeLocation(resume, context.targetId);

  const body = await text(`  new bullet for ${pc.dim(where)}`, { required: true });
  if (body.trim() === '') return;

  const fact = store.add(body);
  const suggestion: Suggestion = {
    // Prefer the entry so the bullet lands at the end of it; for a Skills-style
    // section there is no entry, so anchor to the bullet we were looking at.
    targetId: at?.entryId ?? context.targetId,
    kind: 'add',
    before: '',
    after: fact.text,
    sourceIds: [fact.id],
    rationale: 'written by you during review',
    jdRef: context.jdRef,
    confidence: 1,
    origin: 'user',
  };

  slots.splice(index + 1, 0, { suggestion, verdict: 'accept' });
  console.log('  ' + pc.green(`✓ added as ${fact.id}`));
}
