import { z } from 'zod';
import { ask } from '../claude.js';
import { flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import { CoverageEntrySchema, type CoverageEntry, type JobSpec } from './types.js';

const CoverageResultSchema = z.object({ coverage: z.array(CoverageEntrySchema) });

export function filterKnownIds(coverage: CoverageEntry[], knownIds: ReadonlySet<string>): CoverageEntry[] {
  return coverage.map((entry) => {
    const evidenceIds = entry.evidenceIds.filter((id) => knownIds.has(id));
    return { ...entry, evidenceIds, gap: entry.gap || evidenceIds.length === 0 };
  });
}

const normalize = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * One coverage entry per requirement, in the job's order. The model can skip a
 * requirement or paraphrase it, and an empty array back used to mean an empty
 * match report that read as "nothing to prepare for". A requirement the model
 * gave no verdict on is a gap until something shows otherwise.
 */
export function alignCoverage(requirements: readonly string[], raw: readonly CoverageEntry[]): CoverageEntry[] {
  const byText = new Map(raw.map((entry) => [normalize(entry.requirement), entry]));
  // Positions only mean something when the model answered every requirement.
  const positional = raw.length === requirements.length;
  return requirements.map((requirement, i) => {
    const found = byText.get(normalize(requirement)) ?? (positional ? raw[i] : undefined);
    return found ? { ...found, requirement } : { requirement, evidenceIds: [], gap: true };
  });
}

export async function computeCoverage(
  resume: Resume,
  job: JobSpec,
  signal?: AbortSignal,
): Promise<CoverageEntry[]> {
  const flat = flattenBullets(resume);
  const bulletLines = flat.map((b) => `${b.id}: ${b.text} (${b.context})`).join('\n');
  const requirements = [...job.hardRequirements, ...job.niceToHaves];
  const requirementLines = requirements.map((r) => `- ${r}`).join('\n');

  const result = await ask({
    prompt:
      'Given the resume bullets below (each prefixed with its id) and the job requirements, ' +
      'determine for each requirement which bullet ids (if any) provide evidence of it. ' +
      'Return exactly one entry per requirement, in the order given, with the requirement text ' +
      'copied verbatim. ' +
      'Only cite ids that literally appear in the bullet list. If no bullet supports a ' +
      'requirement, set gap to true and leave evidenceIds empty.\n\n' +
      `--- RESUME BULLETS ---\n${bulletLines}\n\n--- REQUIREMENTS ---\n${requirementLines}`,
    schema: CoverageResultSchema,
    tools: [],
    effort: 'low',
    signal,
  });

  const knownIds = new Set(flat.map((b) => b.id));
  return filterKnownIds(alignCoverage(requirements, result.coverage), knownIds);
}
