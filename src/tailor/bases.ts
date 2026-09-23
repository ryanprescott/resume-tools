import { mkdir, readdir, readFile, access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseMarkdown } from '../parse/markdown.js';
import type { Resume } from '../model/schema.js';

/**
 * Occupation bases.
 *
 * One base resume serves one kind of job. Tailoring reweights what a base
 * already says, which works for the next Full Stack posting and does nothing
 * for a Solutions Architect one: the right starting point there is a resume
 * already framed for that occupation. So a run that pivots to a new occupation
 * can save its result as a new base under `resumes/bases/`, and later postings
 * are matched against every base to pick where to start.
 *
 * There is no index file. A base says what occupation it serves in its own
 * frontmatter (`meta.occupation`), and which jobs it has served is read off
 * the variants that name it in `meta.basedOn` — so nothing can drift out of
 * step with the resumes themselves.
 */

export const BASES_DIR = 'resumes/bases';

export interface BaseInfo {
  path: string;
  resume: Resume;
  /** What the base is for: `meta.occupation`, else its headline. */
  occupation: string;
  /** Jobs already tailored from this base, as "title at company". */
  usedFor: string[];
}

export function occupationOf(resume: Resume): string {
  return resume.meta?.occupation ?? resume.contact.headline ?? 'general';
}

async function resumeFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith('.resume.md'))
      .sort()
      .map((f) => join(dir, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function tryParse(path: string): Promise<Resume | null> {
  try {
    return parseMarkdown(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Job labels per base filename, read from the variants that cite it. */
export async function jobsByBase(variantDir: string): Promise<Map<string, string[]>> {
  const byBase = new Map<string, string[]>();
  for (const path of await resumeFiles(variantDir)) {
    const variant = await tryParse(path);
    const job = variant?.meta?.job;
    const basedOn = variant?.meta?.basedOn;
    if (!job || !basedOn) continue;
    const label = job.company ? `${job.title} at ${job.company}` : job.title;
    byBase.set(basedOn, [...(byBase.get(basedOn) ?? []), label]);
  }
  return byBase;
}

/**
 * Every base: the root one first (already parsed by the caller, which owns
 * the error reporting for it), then `basesDir` — `null` for just the root,
 * which is what an explicit `--from` means. A base that fails to parse is
 * reported and skipped rather than ending the run — it is one candidate of
 * several, and the root base is still there.
 */
export async function loadBases(
  root: { path: string; resume: Resume },
  basesDir: string | null,
  variantDir: string,
  warn: (message: string) => void = console.warn,
): Promise<BaseInfo[]> {
  const used = await jobsByBase(variantDir);
  const info = (path: string, resume: Resume): BaseInfo => ({
    path,
    resume,
    occupation: occupationOf(resume),
    usedFor: used.get(basename(path)) ?? [],
  });

  const bases = [info(root.path, root.resume)];
  for (const path of basesDir === null ? [] : await resumeFiles(basesDir)) {
    if (resolve(path) === resolve(root.path)) continue;
    const resume = await tryParse(path);
    if (resume) bases.push(info(path, resume));
    else warn(`⚠ skipped ${path}: it does not parse as a resume`);
  }
  return bases;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function occupationSlug(occupation: string): string {
  return (
    occupation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'occupation'
  );
}

/** A path for a new base that does not overwrite an existing one. */
export async function newBasePath(basesDir: string, occupation: string): Promise<string> {
  await mkdir(basesDir, { recursive: true });
  const slug = occupationSlug(occupation);
  let path = join(basesDir, `${slug}.resume.md`);
  for (let n = 2; await exists(path); n += 1) path = join(basesDir, `${slug}-${n}.resume.md`);
  return path;
}

/**
 * A pivoted variant, reframed as the starting point for its occupation: the
 * same content, with the job it was tailored for replaced by the occupation it
 * now serves. The headline is yours to set — it is a claim about what you are.
 */
export function asOccupationBase(
  variant: Resume,
  occupation: string,
  headline: string | undefined,
  basedOn: string,
): Resume {
  const base: Resume = structuredClone(variant);
  base.contact.headline = headline?.trim() || base.contact.headline;
  base.meta = { basedOn, occupation };
  return base;
}
