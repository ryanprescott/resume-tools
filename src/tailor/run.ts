import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import pc from 'picocolors';
import { serializeMarkdown } from '../parse/markdown.js';
import { readJd } from '../parse/jd.js';
import type { Resume } from '../model/schema.js';
import { note, rule, stage, wrap } from '../ui/chrome.js';
import { choose, pick, yesNo, Separator } from '../ui/prompts.js';
import { Cancelled, Interrupted } from '../ui/interrupt.js';
import { withSpinner } from '../ui/spinner.js';
import { analyzeJd } from './analyze-jd.js';
import { computeCoverage } from './coverage.js';
import { confirmJobSpec, reportJobSpec } from './confirm-jd.js';
import { emptyInterview, runGapInterview, type InterviewState } from './interview.js';
import { suggest } from './suggest.js';
import { verifySuggestions, type Rejection } from './verify.js';
import { reviewRejections } from './rejections.js';
import { runReview } from './review.js';
import { runAdditions, type AdditionResult } from './additions.js';
import { applyDecisions, withAdditions } from './apply.js';
import { asOccupationBase, borrowable, loadBases, newBasePath, sameEntry, type BaseInfo } from './bases.js';
import { routeJob, type Route } from './route.js';
import { chooseBase, reportRoute, runRolesInterview, type PivotChoice } from './choose-base.js';
import type { Pivot } from './suggest.js';
import { buildResume, resumeBase, type BuildOptions } from '../build.js';
import { FactStore, loadFacts, markUsed, saveFacts } from './facts.js';
import { applyWriteback, citedFactIds, planWriteback, promotedFactIds } from './writeback.js';
import { renderMatchReport } from '../report/match.js';
import { renderKeywordReport } from '../report/keywords.js';
import { generateCoverLetter, renderCoverLetter } from '../report/cover-letter.js';
import { lintResume } from '../lint/bullets.js';
import { lintSummary } from '../ui/lint.js';
import type { CoverageEntry, Decision, JobSpec, Suggestion } from './types.js';

export interface TailorOptions {
  jdFile: string;
  /** The default base — `resumes/base.resume.md` — or whatever `--from` named. */
  root: { path: string; resume: Resume };
  /** `--from` was given: tailor from exactly that base, and look for no others. */
  pinned: boolean;
  /** Occupation bases, matched against the job alongside the root one. */
  basesDir: string;
  company?: string;
  /** Non-interactive: accept every verified suggestion, ask nothing. */
  yes: boolean;
  outDir: string;
  variantDir: string;
  factsPath: string;
  /** Print the variant as soon as it is written. */
  build?: BuildOptions;
}

export interface TailorResult {
  variantPath: string;
  /** You asked, at the end of an interactive run, to build the variant now. */
  build: boolean;
}

const STAGES = ['Job', 'Base', 'Gaps', 'Cut', 'Review', 'Additions'] as const;

/** Stage positions by name, so nothing below depends on counting. */
export const STAGE = { job: 0, base: 1, gaps: 2, cut: 3, review: 4, additions: 5 } as const;

/**
 * Everything the run has worked out so far. Held in one place so a stage can be
 * re-entered without losing what the others produced, and so the expensive
 * results can be reused when their inputs have not moved.
 */
export interface State {
  extracted?: JobSpec;
  job?: JobSpec;
  bases?: BaseInfo[];
  route?: Route;
  routeKey?: string;
  /** Index into `bases` of the one this run tailors from. */
  baseIndex?: number;
  /** Set when this run moves into a new occupation, and will save a base for it. */
  pivot?: PivotChoice;
  /**
   * Related roles added to the base before anything else runs: entries reused
   * from your other bases, and in a pivot the roles you described.
   */
  roles?: AdditionResult;
  coverage?: CoverageEntry[];
  coverageKey?: string;
  interview: InterviewState;
  proposed?: Suggestion[];
  approved?: Suggestion[];
  rejected?: Rejection[];
  suggestKey?: string;
  restored?: Suggestion[];
  decisions?: Decision[];
  extra?: AdditionResult;
}

/**
 * Cache key for a derived result. Going back to an earlier stage and changing
 * nothing must not re-run the model; changing the job title must. Comparing the
 * inputs is the only way to tell those apart, and it beats hand-maintaining a
 * list of what invalidates what.
 */
function keyOf(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

function slugify(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The name a variant and its reports share. Without a company the job file's
 * name stands in, and that is usually named for the role already —
 * `barclays-senior-engineer.md` would otherwise give
 * `senior-engineer-barclays-senior-engineer`.
 */
export function variantSlug(title: string, company: string | undefined, jdFile: string): string {
  if (company) return slugify(title, company);
  const fromFile = slugify(basename(jdFile, extname(jdFile)));
  const titled = slugify(title);
  return fromFile.includes(titled) ? fromFile : slugify(title, fromFile);
}

function countDecisions(decisions: Decision[]): Record<string, number> {
  const counts: Record<string, number> = { accept: 0, edit: 0, reject: 0, skip: 0 };
  for (const d of decisions) counts[d.action] += 1;
  return counts;
}

/** One-line state of each stage, for the navigator. */
export function describeStage(index: number, state: State, store: FactStore): string {
  switch (index) {
    case STAGE.job:
      return state.job
        ? `${state.job.title} · ${state.job.hardRequirements.length} must-have(s)`
        : 'not read yet';
    case STAGE.base: {
      const base = state.baseIndex === undefined ? undefined : state.bases?.[state.baseIndex];
      if (!base) return 'not chosen yet';
      const from = basename(base.path);
      const roles = state.roles?.additions.length ?? 0;
      if (!state.pivot) return roles > 0 ? `${from} · ${roles} related role(s)` : from;
      return `new "${state.pivot.occupation}" base from ${from} · ${roles} related role(s)`;
    }
    case STAGE.gaps: {
      const gaps = state.coverage?.filter((c) => c.gap).length ?? 0;
      return `${gaps} gap(s) · ${Object.keys(state.interview.answers).length} answered`;
    }
    case STAGE.cut:
      return state.rejected === undefined
        ? 'not checked yet'
        : `${state.rejected.length} cut · ${state.restored?.length ?? 0} kept`;
    case STAGE.review: {
      if (!state.decisions) return 'not reviewed yet';
      const counts = countDecisions(state.decisions);
      return `${counts.accept} accepted · ${counts.edit} edited · ${counts.reject} rejected`;
    }
    default: {
      const queued = (state.extra?.decisions.length ?? 0) + (state.extra?.additions.length ?? 0);
      return `${queued} queued · ${store.added().length} fact(s) of your own`;
    }
  }
}

export type NavTarget = number | 'quit' | 'write';

export interface NavChoice {
  name: string;
  value: NavTarget;
  description?: string;
}

/**
 * What the navigator offers: resume where you were, jump back to any stage you
 * have already been through, or stop.
 *
 * Only stages *behind* the cursor are listed — jumping forward would skip the
 * work the later stage depends on. "Write what I have" appears only once there
 * is something to write, which means a confirmed job and a reviewed set of
 * suggestions.
 */
export function navigatorChoices(
  current: number,
  state: State,
  store: FactStore,
): Array<NavChoice | Separator> {
  const canWrite = state.job !== undefined && state.decisions !== undefined;
  return [
    { name: `resume ${current + 1}/${STAGES.length} ${STAGES[current]}`, value: current },
    // At the first stage there is nothing behind you, so the heading would
    // label an empty section.
    ...(current > 0 ? [new Separator(pc.dim('  ── go back to ──'))] : []),
    ...STAGES.slice(0, current).map((title, index) => ({
      name: `${index + 1}/${STAGES.length} ${title}`,
      value: index as NavTarget,
      description: describeStage(index, state, store),
    })),
    new Separator(),
    ...(canWrite
      ? [
          {
            name: 'stop here and write what I have',
            value: 'write' as NavTarget,
            description: describeStage(STAGE.review, state, store),
          },
        ]
      : []),
    { name: 'quit without writing anything', value: 'quit' as NavTarget },
  ];
}

/**
 * Where to go after an interrupt. Offered from anywhere, including mid-request:
 * the point of interrupting a 40-second `suggest` call is usually that you have
 * spotted something wrong further back.
 */
async function navigate(current: number, state: State, store: FactStore): Promise<NavTarget> {
  console.log('\n' + rule('interrupted'));
  console.log(
    wrap(
      'Going back re-runs the model only for what you actually change — return to a stage, ' +
        'change nothing, and the earlier results are reused.',
      2,
      pc.dim,
    ),
  );
  console.log('');

  try {
    return await choose<NavTarget>('Where to?', navigatorChoices(current, state, store), {
      default: current,
      pageSize: 12,
    });
  } catch (err) {
    // Ctrl-C at the navigator itself means "never mind" — carry on where we were.
    if (err instanceof Interrupted) return current;
    throw err;
  }
}

/**
 * The tailoring run.
 *
 * Six checkpoints rather than one, because every stage before the last used to
 * be invisible: the job spec, the gaps and the fabrication check all made
 * decisions on your behalf and reported them, if at all, in a file you read
 * afterwards. Each checkpoint is a place where you know something the tool
 * cannot — and each is escapable with Ctrl-C, because noticing the job title is
 * wrong while reading suggestion nine should not mean starting over.
 */
export async function runTailor(opts: TailorOptions): Promise<TailorResult> {
  const jdText = await readJd(opts.jdFile);
  const interactive = !opts.yes && process.stdin.isTTY === true;

  if (!opts.yes && !interactive) {
    console.warn(note('not a terminal — running non-interactively, as if --yes'));
  }

  const store = new FactStore(await loadFacts(opts.factsPath));
  const state: State = { interview: emptyInterview() };

  /** The base chosen at stage 2, as loaded from disk. */
  const source = (): BaseInfo => state.bases![state.baseIndex!];

  /**
   * What every later stage works on: the chosen base, plus the related roles
   * brought in at the Base stage, so coverage can count them as evidence and
   * suggestions can reframe them.
   */
  const working = (): Resume =>
    state.roles ? withAdditions(source().resume, state.roles.additions) : source().resume;

  const pivotBrief = (): Pivot | undefined =>
    state.pivot && { occupation: state.pivot.occupation, from: source().occupation };

  const ensureSuggestions = async (): Promise<void> => {
    const resume = working();
    const key = keyOf(state.job, store.all(), resume, state.pivot);
    if (state.suggestKey === key) return;

    state.proposed = await withSpinner(
      state.pivot ? `working out what transfers to ${state.pivot.occupation}` : 'working out what to change',
      (signal) => suggest(resume, state.job!, state.coverage!, store.all(), signal, pivotBrief()),
      { done: 'drafted edits' },
    );
    const outcome = await withSpinner(
      `fact-checking ${state.proposed.length} proposed edit(s)`,
      (signal) => verifySuggestions(resume, state.proposed!, store.all(), signal),
    );
    state.approved = outcome.approved;
    state.rejected = outcome.rejected;
    state.restored = undefined;
    state.suggestKey = key;
  };

  const runStage = async (index: number): Promise<void> => {
    console.log(stage(index + 1, STAGES.length, STAGES[index]));

    switch (index) {
      case STAGE.job: {
        state.extracted ??= await withSpinner('reading the job description', (signal) =>
          analyzeJd(jdText, signal),
        );
        const current = state.job ?? state.extracted;
        state.job = interactive ? await confirmJobSpec(current) : (reportJobSpec(current), current);
        return;
      }

      case STAGE.base: {
        state.bases ??= await loadBases(opts.root, opts.pinned ? null : opts.basesDir, opts.variantDir);
        const job = state.job!;
        const key = keyOf(job);
        if (state.routeKey !== key) {
          state.route = await withSpinner(
            state.bases.length === 1
              ? `checking how well ${basename(opts.root.path)} fits this job`
              : `matching the job against ${state.bases.length} bases`,
            (signal) => routeJob(job, state.bases!, signal),
          );
          state.routeKey = key;
        }
        const route = state.route!;

        if (interactive) {
          const prior = state.baseIndex === undefined ? undefined : { index: state.baseIndex, pivot: state.pivot };
          const choice = await chooseBase(state.bases, route, job, prior);
          state.baseIndex = choice.index;
          state.pivot = choice.pivot;
          const base = source().resume;
          // Switching base on a second pass can make a reused entry redundant.
          const kept = state.roles && {
            ...state.roles,
            additions: state.roles.additions.filter(
              (a) => a.kind !== 'entry' || !base.sections.some((s) => s.entries?.some((e) => sameEntry(e, a.entry))),
            ),
          };
          state.roles = await runRolesInterview(
            base,
            store,
            {
              borrow: borrowable(state.bases, route.relevant, base),
              relatedRoles: route.relatedRoles,
              occupation: state.pivot?.occupation ?? job.occupation,
              pivot: state.pivot !== undefined,
            },
            kept,
          );
        } else {
          reportRoute(state.bases, route, job);
          state.baseIndex = route.baseIndex;
          // Nobody is here to vouch for a new headline, so the base keeps its own.
          state.pivot =
            route.fit === 'none'
              ? { occupation: job.occupation, headline: source().resume.contact.headline ?? job.occupation }
              : undefined;
        }
        return;
      }

      case STAGE.gaps: {
        const resume = working();
        const key = keyOf(state.job, resume);
        if (state.coverageKey !== key) {
          const total = state.job!.hardRequirements.length + state.job!.niceToHaves.length;
          state.coverage = await withSpinner(
            `checking your resume against ${total} requirement(s)`,
            (signal) => computeCoverage(resume, state.job!, signal),
          );
          state.coverageKey = key;
        }
        if (interactive) {
          state.interview = await runGapInterview(state.coverage!, store, state.interview);
        } else {
          const gaps = state.coverage!.filter((c) => c.gap).length;
          console.log(note(`  ${gaps} requirement(s) with no evidence — see the match report`));
        }
        return;
      }

      case STAGE.cut: {
        await ensureSuggestions();
        if (interactive) {
          state.restored = await reviewRejections(state.rejected!, working(), state.restored);
        } else {
          for (const { suggestion, reason } of state.rejected!) {
            console.error(pc.red(`✗ cut ${suggestion.targetId}: ${reason}`));
          }
          state.restored = [];
        }
        return;
      }

      case STAGE.review: {
        await ensureSuggestions();
        const toReview = [...state.approved!, ...(state.restored ?? [])];
        if (interactive) {
          state.decisions = (await runReview(toReview, working(), store, state.decisions ?? [])).decisions;
        } else {
          state.decisions = toReview.map((suggestion) => ({ suggestion, action: 'accept' as const }));
        }
        return;
      }

      default: {
        if (interactive) state.extra = await runAdditions(working(), store, state.extra);
        return;
      }
    }
  };

  // ── The stage loop ────────────────────────────────────────────────────────
  let cursor = 0;
  let stopEarly = false;

  while (cursor < STAGES.length && !stopEarly) {
    try {
      await runStage(cursor);
      cursor += 1;
    } catch (err) {
      if (!(err instanceof Interrupted)) throw err;
      // Nobody is there to answer the navigator in a non-interactive run.
      if (!interactive) throw new Cancelled();

      const target = await navigate(cursor, state, store);
      if (target === 'quit') throw new Cancelled();
      if (target === 'write') stopEarly = true;
      else cursor = target;
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const job = state.job!;
  const from = source();
  const decisions = [...(state.decisions ?? []), ...(state.extra?.decisions ?? [])];
  const additions = state.extra?.additions ?? [];

  // The posting's own company name wins over the file it arrived in; the file
  // name is only a fallback for the slug, never written into the resume.
  const company = opts.company ?? (job.company || undefined);
  const slug = variantSlug(job.title, company, opts.jdFile);
  const variant = applyDecisions(
    working(),
    decisions,
    { company, title: job.title, recruiter: job.recruiter || undefined },
    basename(from.path),
    additions,
  );

  await mkdir(opts.variantDir, { recursive: true });
  await mkdir(opts.outDir, { recursive: true });

  const written: string[] = [];

  // A pivot's result becomes the starting point for its occupation, so the
  // next posting like this one starts here instead of pivoting again.
  if (state.pivot) {
    const { occupation, headline } = state.pivot;
    let save = true;
    if (interactive) {
      try {
        console.log('');
        save = await yesNo(`Save this as your base for ${occupation} jobs?`, { default: true });
      } catch (err) {
        if (!(err instanceof Interrupted)) throw err;
        save = false;
      }
    }
    if (headline) variant.contact.headline = headline;
    if (save) {
      const basePath = await newBasePath(opts.basesDir, occupation);
      const base = asOccupationBase(variant, occupation, headline, basename(from.path));
      await writeFile(basePath, serializeMarkdown(base), 'utf8');
      written.push(basePath);
      // The variant descends from the new base now, which is what lets later
      // runs see that this base has served a job like this one.
      variant.meta = { ...variant.meta, basedOn: basename(basePath) };
    }
  }

  const variantPath = join(opts.variantDir, `${slug}.resume.md`);
  await writeFile(variantPath, serializeMarkdown(variant), 'utf8');
  written.push(variantPath);

  // Facts land next, before anything that can fail: by this point you have
  // answered six stages of questions, and none of that should be lost because
  // a report generator threw.
  const cited = citedFactIds(variant);
  let facts = markUsed(store.all(), cited, slug);
  if (store.added().length > 0 || cited.size > 0) {
    await saveFacts(facts, opts.factsPath);
  }

  // The PDF next — it is what you came for, and the reports below include a
  // cover letter that takes the better part of a minute.
  const buildNotes: string[] = [];
  if (opts.build) {
    try {
      const built = await buildResume(variant, resumeBase(variantPath), opts.build);
      written.push(...built.written);
      buildNotes.push(...built.notes);
    } catch (err) {
      if (err instanceof Interrupted) buildNotes.push(`⚠ skipped the build`);
      else buildNotes.push(`⚠ could not build ${variantPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Reports are secondary; one failing must not take the run down with it. */
  const tryWrite = async (path: string, produce: () => Promise<string> | string): Promise<void> => {
    try {
      await writeFile(path, await produce(), 'utf8');
      written.push(path);
    } catch (err) {
      if (err instanceof Interrupted) {
        console.warn(pc.yellow(`⚠ skipped ${path}`));
        return;
      }
      console.warn(pc.yellow(`⚠ could not write ${path}: ${err instanceof Error ? err.message : err}`));
    }
  };

  await tryWrite(join(opts.outDir, `${slug}.match.md`), () =>
    renderMatchReport(job, state.coverage ?? []),
  );
  await tryWrite(join(opts.outDir, `${slug}.keywords.md`), () => renderKeywordReport(job, variant));

  let letterWarning = '';
  await tryWrite(join(opts.outDir, `${slug}.cover-letter.md`), async () => {
    const draft = await withSpinner('drafting a cover letter', (signal) =>
      generateCoverLetter(variant, job, company ?? 'the company', signal),
    );
    if (!draft.approved) letterWarning = draft.reason;
    return renderCoverLetter(draft);
  });

  console.log('\n' + rule('done'));
  const counts = countDecisions(decisions);
  console.log(
    `  ${pc.green(`${counts.accept} accepted`)}  ${pc.cyan(`${counts.edit} edited`)}  ` +
      `${pc.red(`${counts.reject} rejected`)}  ${pc.dim(`${counts.skip} skipped`)}` +
      (store.added().length > 0 ? pc.cyan(`  +${store.added().length} of your own`) : ''),
  );
  for (const path of written) console.log(`  wrote ${path}`);
  if (store.added().length > 0) console.log(`  wrote ${opts.factsPath}`);
  for (const line of buildNotes) console.log(`  ${line.startsWith('⚠') ? pc.yellow(line) : note(line)}`);
  // Tailoring rewrites bullets, so the variant's writing is worth a look of its own.
  const findings = lintResume(variant);
  if (findings.length > 0) console.log(`  ${lintSummary(findings)} — npm run cli -- lint ${variantPath}`);
  if (letterWarning !== '') {
    console.log('');
    console.log(pc.yellow('  ⚠ the cover letter draft did not pass the grounding check:'));
    console.log(wrap(letterWarning, 4, pc.dim));
    console.log(pc.dim('    it was written anyway, with that warning at the top'));
  }

  // ── Write-back ────────────────────────────────────────────────────────────
  // Into the base this run started from. Related roles are offered too —
  // reused from another base or described in a pivot, they are true of you
  // whatever you apply for.
  const writeBack = async (): Promise<void> => {
    const plan = planWriteback(from.resume, variant);
    if (plan.length === 0) return;

    try {
      console.log('');
      console.log(
        note(`  ${plan.length} thing(s) you added are only in this variant. Put any of them in ${from.path}?`),
      );
      const chosen = await pick(
        'Write back to the base resume?',
        plan.map((item, i) => ({
          name:
            item.kind === 'entry'
              ? `${item.entry.title} — ${item.entry.org}  ${pc.dim(`(${item.where})`)}`
              : `${item.text.slice(0, 62)}${item.text.length > 62 ? '…' : ''}  ${pc.dim(`(${item.where})`)}`,
          value: i,
        })),
      );
      if (chosen.length === 0) {
        console.log(note(`  left in ${opts.factsPath}`));
        return;
      }

      const selected = chosen.map((i) => plan[i]);
      const updated = applyWriteback(from.resume, selected);
      await writeFile(from.path, serializeMarkdown(updated), 'utf8');
      console.log(`  ${pc.green('✓')} updated ${from.path}`);

      // A fact now in the base resume would otherwise be offered as new material
      // again on the next run, so it leaves the staging file.
      const promoted = promotedFactIds(selected);
      facts = facts.filter((fact) => !promoted.has(fact.id));
      await saveFacts(facts, opts.factsPath);
      console.log(`  ${pc.green('✓')} retired ${promoted.size} fact(s) from ${opts.factsPath}`);
    } catch (err) {
      // Everything above is already on disk; declining the write-back is fine.
      if (!(err instanceof Interrupted)) throw err;
      console.log(note(`  left in ${opts.factsPath}`));
    }
  };

  if (!interactive) return { variantPath, build: false };
  await writeBack();

  // ── Build ─────────────────────────────────────────────────────────────────
  // Offered last, so the build is the whole of what is left to do: the caller
  // ends this session and runs it as a fresh `build`.
  if (opts.build) return { variantPath, build: false };
  let build = false;
  try {
    console.log('');
    build = await yesNo('Build the PDF for this variant now?', { default: true });
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
  }
  if (!build) console.log(note(`  build it later with: npm run cli -- build ${variantPath}`));
  return { variantPath, build };
}
