import pc from 'picocolors';
import { note, wrap } from '../ui/chrome.js';
import { choose, longText, pick, text, yesNo, Separator } from '../ui/prompts.js';
import type { FactStore } from './facts.js';
import type { CoverageEntry } from './types.js';

/**
 * The gap interview.
 *
 * Coverage already knows which requirements have no evidence in the resume. The
 * old flow turned that straight into a line in the match report; here it becomes
 * a question, because "no evidence in the resume" and "no experience" are
 * different things and only you can tell them apart.
 *
 * You are asked to pick the gaps you can speak to first, rather than being
 * marched through every one — a long posting can produce a dozen, and a prompt
 * you have to dismiss eleven times stops being read.
 */

const SHORT_ANSWER_LIMIT = 240;

/**
 * Which requirement each captured fact answers. Held for the run rather than
 * written to `facts.md`, whose contents outlive any one job. Without it,
 * re-entering this stage from the navigator would ask everything again and
 * capture a second copy of every answer.
 */
export interface InterviewState {
  answers: Record<string, string>;
}

export function emptyInterview(): InterviewState {
  return { answers: {} };
}

async function captureAnswer(requirement: string): Promise<string> {
  console.log('');
  console.log(`  ${pc.bold(requirement)}`);
  const answer = await text('  what did you do? (your words, one line)');

  let body = answer.trim();
  if (body !== '' && body.length >= SHORT_ANSWER_LIMIT) {
    // A long answer typed at a single-line prompt is painful to correct.
    const expand = await yesNo('  open an editor to finish that?', { default: false });
    if (expand) body = (await longText('  the full version', { default: body })).trim();
  }
  return body;
}

export async function runGapInterview(
  coverage: CoverageEntry[],
  store: FactStore,
  state: InterviewState = emptyInterview(),
): Promise<InterviewState> {
  const gaps = coverage.filter((c) => c.gap);
  const answers = { ...state.answers };

  const carried = store.all().filter((f) => !store.added().includes(f));
  if (carried.length > 0) {
    console.log('');
    console.log(note(`  ${carried.length} saved fact(s) from earlier runs are in play:`));
    for (const fact of carried) console.log(wrap(`${pc.dim(fact.id)} ${fact.text}`, 4));
  }

  if (gaps.length === 0) {
    console.log('');
    console.log(pc.green('  ✓ every requirement has evidence in your resume'));
    return { answers };
  }

  console.log('');
  console.log(
    wrap(
      `${gaps.length} requirement(s) have no evidence in your resume. Anything you tell me here ` +
        'becomes source material the tailoring can draw on, and is saved for next time.',
      2,
      pc.dim,
    ),
  );
  console.log('');

  const chosen = await pick(
    'Which of these do you actually have experience with?',
    gaps.map((gap) => ({
      name: answers[gap.requirement]
        ? `${gap.requirement}  ${pc.dim(`— "${store.get(answers[gap.requirement])?.text ?? ''}"`)}`
        : gap.requirement,
      value: gap.requirement,
      checked: answers[gap.requirement] !== undefined,
    })),
  );

  // Unpicking something you answered on an earlier pass retracts it, rather
  // than leaving an orphan fact behind that nothing points at.
  for (const [requirement, factId] of Object.entries(answers)) {
    if (!chosen.includes(requirement)) {
      store.remove(factId);
      delete answers[requirement];
    }
  }

  for (const requirement of chosen) {
    if (answers[requirement] !== undefined) continue;
    const body = await captureAnswer(requirement);
    if (body === '') {
      console.log(note('  skipped'));
      continue;
    }
    const fact = store.add(body);
    answers[requirement] = fact.id;
    console.log('  ' + pc.green(`✓ saved as ${fact.id}`));
  }

  // Amend loop, so a wording you regret does not mean restarting the stage.
  for (;;) {
    const answered = Object.entries(answers);
    if (answered.length === 0) break;

    const target = await choose<string>(
      'Happy with those?',
      [
        { name: 'yes, carry on', value: '' },
        new Separator(),
        ...answered.map(([requirement, factId]) => ({
          name: `reword: ${store.get(factId)?.text ?? requirement}`,
          value: factId,
          description: requirement,
        })),
      ],
      { default: '', pageSize: 12 },
    );
    if (target === '') break;

    const revised = await text('  reword', { default: store.get(target)?.text, required: true });
    store.update(target, revised);
  }

  if (Object.keys(answers).length === 0) {
    console.log(note('  nothing added — these will be listed as gaps in the match report'));
  }
  return { answers };
}
