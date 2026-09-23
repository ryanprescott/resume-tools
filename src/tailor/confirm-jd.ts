import pc from 'picocolors';
import { note, panel, wrap } from '../ui/chrome.js';
import { choose, pick, text } from '../ui/prompts.js';
import type { JobSpec } from './types.js';

/**
 * Everything downstream — coverage, suggestions, the keyword report — is derived
 * from this one extraction. If it misreads the posting, every later stage is
 * confidently wrong in a way that is hard to spot from the output, so it is
 * worth thirty seconds of your attention before the expensive steps run.
 */

function splitCommaList(input: string): string[] {
  return input
    .split(/[,;]|\s•\s/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Uncheck to drop, then type to append. Two passes beats editing a blob. */
async function editList(label: string, items: string[]): Promise<string[]> {
  const kept =
    items.length > 0
      ? await pick(
          `${label} — uncheck anything that isn't really there`,
          items.map((item) => ({ name: item, value: item, checked: true })),
        )
      : [];

  const extra = await text(`  add to ${label} ${pc.dim('(comma-separated, blank to skip)')}`, {
    prefill: false,
  });
  return [...kept, ...splitCommaList(extra)];
}

function summarize(job: JobSpec): void {
  console.log('');
  console.log(
    panel({
      title: 'What I read from the job description',
      lines: [
        `${pc.bold(job.title)} ${pc.dim('·')} ${job.seniority} ${pc.dim('·')} ${job.domain}`,
        `${pc.dim('company')} ${job.company || pc.dim('(not named)')}  ${pc.dim('recruiter')} ${job.recruiter || pc.dim('(not named)')}`,
        `${pc.dim('occupation')} ${job.occupation}`,
      ],
    }),
  );

  const block = (label: string, items: string[]): void => {
    console.log('');
    console.log(`  ${pc.bold(label)} ${pc.dim(`(${items.length})`)}`);
    if (items.length === 0) {
      console.log(note('    (none)'));
      return;
    }
    for (const item of items) console.log(wrap(`• ${item}`, 4, undefined));
  };

  block('must have', job.hardRequirements);
  block('nice to have', job.niceToHaves);
  console.log('');
  console.log(`  ${pc.bold('keywords')} ${pc.dim(`(${job.keywords.length})`)}`);
  console.log(wrap(job.keywords.join(' · '), 4, pc.dim));
}

export async function confirmJobSpec(job: JobSpec): Promise<JobSpec> {
  let current: JobSpec = { ...job };

  for (;;) {
    summarize(current);
    console.log('');

    const action = await choose<string>(
      'Does that read the job right?',
      [
        { name: 'yes, carry on', value: 'ok' },
        { name: 'fix the title, company, recruiter or occupation', value: 'header' },
        { name: `edit must-haves (${current.hardRequirements.length})`, value: 'hard' },
        { name: `edit nice-to-haves (${current.niceToHaves.length})`, value: 'nice' },
        { name: `edit keywords (${current.keywords.length})`, value: 'keywords' },
      ],
      { default: 'ok' },
    );

    if (action === 'ok') return current;

    if (action === 'header') {
      current = {
        ...current,
        title: await text('  title', { default: current.title, required: true }),
        company: (await text('  company (blank if not named)', { default: current.company })).trim(),
        recruiter: (await text('  recruiter (blank if not named)', { default: current.recruiter })).trim(),
        occupation: await text('  occupation', { default: current.occupation, required: true }),
        seniority: await text('  seniority', { default: current.seniority }),
        domain: await text('  domain', { default: current.domain }),
      };
      continue;
    }

    if (action === 'hard') {
      current = { ...current, hardRequirements: await editList('must-haves', current.hardRequirements) };
    } else if (action === 'nice') {
      current = { ...current, niceToHaves: await editList('nice-to-haves', current.niceToHaves) };
    } else {
      current = { ...current, keywords: await editList('keywords', current.keywords) };
    }
  }
}

/** Used by `--yes`: print the spec without stopping, so it is still on record. */
export function reportJobSpec(job: JobSpec): void {
  summarize(job);
}
