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
  relatedRoles: z.array(z.string()),
});

export interface Route {
  /** Index into the bases the route was computed over. */
  baseIndex: number;
  fit: Fit;
  reason: string;
  /** Kinds of experience worth asking you about if this run pivots. */
  relatedRoles: string[];
}

const keyOf = (index: number): string => `b${index + 1}`;

/** A base as the model sees it: enough to judge the occupation, not the full text. */
export function describeBase(base: BaseInfo, index: number): string {
  const lines = [`[${keyOf(index)}] occupation: ${base.occupation}`];
  if (base.resume.contact.headline) lines.push(`headline: ${base.resume.contact.headline}`);

  for (const section of base.resume.sections) {
    if (section.bullets) {
      for (const bullet of section.bullets) lines.push(`${section.name}: ${bullet.text}`);
    } else {
      const roles = (section.entries ?? []).map((e) => `${e.title} — ${e.org}`);
      if (roles.length > 0) lines.push(`${section.name}: ${roles.join('; ')}`);
    }
  }
  if (base.usedFor.length > 0) lines.push(`already tailored for: ${base.usedFor.join('; ')}`);
  return lines.join('\n');
}

/** Map the model's answer back onto real bases; an unknown key falls back to the first. */
export function resolveRoute(raw: z.infer<typeof RouteSchema>, baseCount: number): Route {
  const n = Number(raw.baseKey.replace(/^\[?b/i, '').replace(/\]$/, ''));
  const baseIndex = Number.isInteger(n) && n >= 1 && n <= baseCount ? n - 1 : 0;
  return {
    baseIndex,
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
      'Set relatedRoles to 4-8 short labels for kinds of past roles, occupations, volunteer work ' +
      'or side work that would be directly relevant to this job and that the chosen base does ' +
      'NOT already show — things worth asking the candidate whether they have done (e.g. for an ' +
      'IT Support job: "Help desk technician", "Systems administrator", "Retail tech support"). ' +
      'These are questions, not claims.',
    schema: RouteSchema,
    tools: [],
    effort: 'low',
    signal,
  });
  return resolveRoute(raw, bases.length);
}
