import { z } from 'zod';
import { ask } from '../claude.js';
import type { BaseInfo } from './bases.js';
import type { JobSpec } from './types.js';

/**
 * Which base a job description should be tailored from, and whether any of
 * them is close enough to tailor at all.
 *
 * "Close enough" is the question that decides the whole run. A posting in the
 * same occupation needs reweighting; one in a different occupation needs the
 * experience reframed around what transfers, and it needs you asked about
 * related work the resume never mentions — a resume written for engineering
 * jobs leaves out the year you ran a help desk, and that year is the most
 * relevant thing you have for an IT Support posting.
 */

export type Fit = 'strong' | 'partial' | 'none';

const RouteSchema = z.object({
  baseKey: z.string(),
  fit: z.enum(['strong', 'partial', 'none']),
  reason: z.string(),
  relevantEntries: z.array(z.object({ baseKey: z.string(), entryId: z.string() })),
  relatedRoles: z.array(z.string()),
});

export interface Route {
  /** Index into the bases the route was computed over. */
  baseIndex: number;
  fit: Fit;
  reason: string;
  /**
   * Entries in any base that bear on this job. The ones the chosen base lacks
   * are offered for reuse before you are asked about anything new.
   */
  relevant: Array<{ baseIndex: number; entryId: string }>;
  /** Kinds of experience no base shows, worth asking you about if this run pivots. */
  relatedRoles: string[];
}

const keyOf = (index: number): string => `b${index + 1}`;

/**
 * A base as the model sees it: the occupation, and each entry by id with its
 * bullets — a title alone does not say whether an old job had the help desk in it.
 */
export function describeBase(base: BaseInfo, index: number): string {
  const lines = [`[${keyOf(index)}] occupation: ${base.occupation}`];
  if (base.resume.contact.headline) lines.push(`headline: ${base.resume.contact.headline}`);

  for (const section of base.resume.sections) {
    if (section.bullets) {
      for (const bullet of section.bullets) lines.push(`${section.name}: ${bullet.text}`);
      continue;
    }
    for (const e of section.entries ?? []) {
      lines.push(`${section.name} [${e.id}]: ${e.title} — ${e.org} (${e.start} .. ${e.end})`);
      for (const bullet of e.bullets) lines.push(`  - ${bullet.text}`);
    }
  }
  if (base.usedFor.length > 0) lines.push(`already tailored for: ${base.usedFor.join('; ')}`);
  return lines.join('\n');
}

/** A key such as "b2" or "[b2]" as an index, or -1 when it names no base. */
function indexOf(key: string, baseCount: number): number {
  const n = Number(key.trim().replace(/^\[?b/i, '').replace(/\]$/, ''));
  return Number.isInteger(n) && n >= 1 && n <= baseCount ? n - 1 : -1;
}

/**
 * Map the model's answer back onto real bases; an unknown base key falls back
 * to the first, and a relevant entry that names nothing real is dropped.
 */
export function resolveRoute(raw: z.infer<typeof RouteSchema>, bases: BaseInfo[]): Route {
  const relevant: Route['relevant'] = [];
  for (const r of raw.relevantEntries) {
    const baseIndex = indexOf(r.baseKey, bases.length);
    const entryId = r.entryId.trim().replace(/^\[|\]$/g, '');
    if (baseIndex < 0) continue;
    if (!bases[baseIndex].resume.sections.some((s) => s.entries?.some((e) => e.id === entryId))) continue;
    if (relevant.some((x) => x.baseIndex === baseIndex && x.entryId === entryId)) continue;
    relevant.push({ baseIndex, entryId });
  }
  return {
    baseIndex: Math.max(0, indexOf(raw.baseKey, bases.length)),
    relevant,
    fit: raw.fit,
    reason: raw.reason,
    relatedRoles: [...new Set(raw.relatedRoles.map((r) => r.trim()).filter(Boolean))].slice(0, 8),
  };
}

export async function routeJob(job: JobSpec, bases: BaseInfo[], signal?: AbortSignal): Promise<Route> {
  const raw = await ask({
    prompt:
      'A candidate keeps one base resume per occupation they apply for. Decide which base this ' +
      'job should be tailored from, and how well it fits.\n\n' +
      `--- JOB ---\ntitle: ${job.title}\noccupation: ${job.occupation}\ndomain: ${job.domain}\n` +
      `must have:\n${job.hardRequirements.map((r) => `- ${r}`).join('\n') || '(none)'}\n` +
      `nice to have:\n${job.niceToHaves.map((r) => `- ${r}`).join('\n') || '(none)'}\n\n` +
      `--- BASES ---\n${bases.map(describeBase).join('\n\n')}\n\n` +
      'Set baseKey to the key (e.g. "b1") of the base whose occupation and content are closest ' +
      'to the job. Weigh the jobs a base has already been tailored for as evidence of what it ' +
      'serves. Set fit to:\n' +
      '- "strong" when the job is the same occupation the base serves;\n' +
      '- "partial" when it is an adjacent occupation and most requirements could be met by ' +
      'reweighting what the base already says;\n' +
      '- "none" when it is a different occupation, and the experience would have to be reframed ' +
      'around what transfers.\n' +
      'Explain the call in one or two sentences in reason.\n\n' +
      'Set relevantEntries to every entry, in ANY base, whose title or bullets show experience ' +
      'directly relevant to this job — each as the base key and the entry id in brackets (e.g. ' +
      '{"baseKey": "b2", "entryId": "r3"}). Include entries from bases you did not choose: the ' +
      'candidate will be offered those to reuse, rather than asked to describe them again. ' +
      'Leave out entries that are merely generic.\n\n' +
      'Set relatedRoles to 0-8 short labels for kinds of past roles, occupations, volunteer work ' +
      'or side work that would be directly relevant to this job and that NO base shows — things ' +
      'worth asking the candidate whether they have done (e.g. for an IT Support job: "Help desk ' +
      'technician", "Systems administrator", "Retail tech support"). Anything an entry in any ' +
      'base already covers belongs in relevantEntries, not here. These are questions, not claims.',
    schema: RouteSchema,
    tools: [],
    effort: 'low',
    signal,
  });
  return resolveRoute(raw, bases);
}
