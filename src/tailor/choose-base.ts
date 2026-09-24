import { basename } from 'node:path';
import pc from 'picocolors';
import type { Resume } from '../model/schema.js';
import { field, note, panel, wrap } from '../ui/chrome.js';
import { choose, pick, text, Separator } from '../ui/prompts.js';
import { addEntry, type AdditionResult } from './additions.js';
import { collectKnownIds } from '../model/flatten.js';
import { copyEntry, type BaseInfo, type Borrowable } from './bases.js';
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
  return roles.additions.flatMap((a) =>
    a.kind === 'entry' ? a.entry.bullets.map((b) => b.id).filter((id) => /^u\d+$/.test(id)) : [],
  );
}

export interface RolesPrompt {
  /** Relevant entries your other bases have and this one lacks. */
  borrow: Borrowable[];
  /** Kinds of role no base shows; asked about only in a pivot. */
  relatedRoles: string[];
  occupation: string;
  pivot: boolean;
}

/**
 * The related-roles interview. A resume written for one occupation leaves out
 * whatever did not serve it, and that is often the most relevant thing you
 * have. What another base already says is offered first, as it stands — you
 * wrote it once and should not have to again. Only then, in a pivot, are you
 * asked about kinds of role no base shows. Each role becomes a whole entry,
 * added before anything is suggested, so the suggestions can reframe and
 * reorder it like the rest.
 */
export async function runRolesInterview(
  resume: Resume,
  store: FactStore,
  ask: RolesPrompt,
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

  const fresh = out.additions.length === 0;

  if (fresh && ask.borrow.length > 0) {
    console.log('');
    console.log(
      wrap(
        `Your other bases have ${ask.borrow.length === 1 ? 'an entry' : 'entries'} that would count ` +
          `for this ${ask.occupation} job and this base leaves out. Pick any to bring in as they ` +
          'stand — the tailoring can reframe them like the rest.',
        2,
        pc.dim,
      ),
    );
    console.log('');
    const chosen = await pick(
      'Bring any of these in?',
      ask.borrow.map((b, i) => ({
        name: `${b.entry.title} — ${b.entry.org}  ${pc.dim(`(${b.entry.start} .. ${b.entry.end} · ${basename(b.base.path)})`)}`,
        value: i,
        checked: true,
      })),
    );
    const taken = new Set(collectKnownIds(resume).allIds);
    for (const i of chosen) {
      const { section, entry } = ask.borrow[i];
      out.additions.push({ kind: 'entry', section, entry: copyEntry(entry, taken) });
    }
    if (chosen.length > 0) console.log('  ' + pc.green(`✓ ${chosen.length} entr${chosen.length === 1 ? 'y' : 'ies'} queued`));
  }

  if (!ask.pivot) return out;

  if (fresh && ask.relatedRoles.length > 0) {
    console.log('');
    console.log(
      wrap(
        `These would count for a ${ask.occupation} job, and none of your bases show any of them. ` +
          'Pick the ones you have actually done — paid, volunteer or on the side — and describe ' +
          'each in your own words.',
        2,
        pc.dim,
      ),
    );
    console.log('');
    const chosen = await pick(
      'Have you done any of these?',
      ask.relatedRoles.map((role) => ({ name: role, value: role })),
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
