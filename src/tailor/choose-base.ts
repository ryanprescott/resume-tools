import { basename } from 'node:path';
import pc from 'picocolors';
import type { Resume } from '../model/schema.js';
import { field, note, panel, wrap } from '../ui/chrome.js';
import { choose, pick, text, Separator } from '../ui/prompts.js';
import { addEntry, type AdditionResult } from './additions.js';
import type { BaseInfo } from './bases.js';
import type { FactStore } from './facts.js';
import type { Route } from './route.js';
import type { JobSpec } from './types.js';

/**
 * The Base stage: which resume to start from, and whether this run is ordinary
 * tailoring or a pivot into an occupation none of your bases covers.
 */

export interface PivotChoice {
  /** The occupation the new base will serve; also what later postings are matched on. */
  occupation: string;
  headline: string;
}

export interface BaseChoice {
  index: number;
  pivot?: PivotChoice;
}

const FIT_LABEL: Record<Route['fit'], string> = {
  strong: pc.green('strong fit'),
  partial: pc.yellow('partial fit'),
  none: pc.red('different occupation'),
};

function summarize(bases: BaseInfo[], route: Route, job: JobSpec): void {
  const best = bases[route.baseIndex];
  console.log('');
  console.log(
    panel({
      title: 'Where to start',
      lines: [
        field('this job', `${job.occupation} ${pc.dim(`(${job.title})`)}`),
        field('closest base', `${best.occupation} ${pc.dim(`· ${basename(best.path)}`)} · ${FIT_LABEL[route.fit]}`),
      ],
    }),
  );
  console.log(wrap(route.reason, 2, pc.dim));
}

/** `--yes`: print the decision without asking, so it is still on record. */
export function reportRoute(bases: BaseInfo[], route: Route, job: JobSpec): void {
  summarize(bases, route, job);
  if (route.fit === 'none') {
    console.log(note(`  pivoting: a new "${job.occupation}" base will be saved alongside the variant`));
  }
}

const PIVOT = -1;

export async function chooseBase(
  bases: BaseInfo[],
  route: Route,
  job: JobSpec,
  prior?: BaseChoice,
): Promise<BaseChoice> {
  summarize(bases, route, job);
  console.log('');

  const best = bases[route.baseIndex];
  const recommended = route.fit === 'none' ? PIVOT : route.baseIndex;
  const tag = (value: number): string => (value === recommended ? pc.dim('  (recommended)') : '');

  const ordered = [route.baseIndex, ...bases.map((_, i) => i).filter((i) => i !== route.baseIndex)];
  const picked = await choose<number>(
    'Tailor from which base?',
    [
      ...ordered.map((i) => ({
        name: `${bases[i].occupation} ${pc.dim(`· ${basename(bases[i].path)}`)}${tag(i)}`,
        value: i,
        description:
          bases[i].usedFor.length > 0
            ? `used for ${bases[i].usedFor.length} job(s), e.g. ${bases[i].usedFor.at(-1)}`
            : 'not used for a job yet',
      })),
      new Separator(),
      {
        name: `start a new "${job.occupation}" base from ${basename(best.path)}${tag(PIVOT)}`,
        value: PIVOT,
        description:
          'reframe what transfers, ask about related roles your resume leaves out, and save the ' +
          'result as a base for jobs like this one',
      },
    ],
    { default: prior ? (prior.pivot ? PIVOT : prior.index) : recommended, pageSize: 12 },
  );

  if (picked !== PIVOT) return { index: picked };

  const occupation = (
    await text('  occupation for the new base', {
      default: prior?.pivot?.occupation ?? job.occupation,
      required: true,
    })
  ).trim();
  const headline = (
    await text('  headline under your name', {
      default: prior?.pivot?.headline ?? occupation,
      required: true,
    })
  ).trim();
  return { index: route.baseIndex, pivot: { occupation, headline } };
}

/** Facts captured for queued entries — so starting over can retract them. */
function factIdsOf(roles: AdditionResult): string[] {
  return roles.additions.flatMap((a) => (a.kind === 'entry' ? a.entry.bullets.map((b) => b.id) : []));
}

/**
 * The related-roles interview. A resume written for one occupation leaves out
 * whatever did not serve it, and in a pivot that is often the most relevant
 * thing you have. Each role you pick becomes a whole entry — title, dates,
 * bullets in your own words — added before anything is suggested, so the
 * suggestions can reframe and reorder it like the rest.
 */
export async function runRolesInterview(
  resume: Resume,
  store: FactStore,
  relatedRoles: string[],
  occupation: string,
  prior: AdditionResult = { decisions: [], additions: [] },
): Promise<AdditionResult> {
  let out: AdditionResult = { decisions: [...prior.decisions], additions: [...prior.additions] };

  if (out.additions.length > 0) {
    console.log('');
    console.log(note(`  ${out.additions.length} related role(s) already added:`));
    for (const a of out.additions) {
      if (a.kind === 'entry') console.log(`    ${a.entry.title} — ${a.entry.org}`);
    }
    const next = await choose<string>('Keep them?', [
      { name: 'yes, carry on', value: 'keep' },
      { name: 'keep them and add another', value: 'more' },
      { name: 'start over', value: 'clear' },
    ]);
    if (next === 'keep') return out;
    if (next === 'clear') {
      for (const id of factIdsOf(out)) store.remove(id);
      out = { decisions: [], additions: [] };
    }
  }

  if (out.additions.length === 0 && relatedRoles.length > 0) {
    console.log('');
    console.log(
      wrap(
        `These would count for a ${occupation} job, and your resume does not show any of them. ` +
          'Pick the ones you have actually done — paid, volunteer or on the side — and describe ' +
          'each in your own words.',
        2,
        pc.dim,
      ),
    );
    console.log('');
    const chosen = await pick(
      'Have you done any of these?',
      relatedRoles.map((role) => ({ name: role, value: role })),
    );
    for (const role of chosen) {
      console.log('');
      console.log(`  ${pc.bold(role)}`);
      await addEntry(resume, store, out, { title: role });
    }
  }

  for (;;) {
    console.log('');
    const more = await choose<string>(
      out.additions.length === 0 ? 'Any other related experience to add?' : `Anything else related? (${out.additions.length} added)`,
      [
        { name: 'no, carry on', value: 'done' },
        { name: 'another role, job or project', value: 'entry' },
      ],
      { default: 'done' },
    );
    if (more === 'done') return out;
    await addEntry(resume, store, out);
  }
}
