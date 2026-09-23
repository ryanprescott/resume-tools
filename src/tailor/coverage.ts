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

export async function computeCoverage(
  resume: Resume,
  job: JobSpec,
  signal?: AbortSignal,
): Promise<CoverageEntry[]> {
  const flat = flattenBullets(resume);
  const bulletLines = flat.map((b) => `${b.id}: ${b.text} (${b.context})`).join('\n');
  const requirementLines = [...job.hardRequirements, ...job.niceToHaves].map((r) => `- ${r}`).join('\n');

  const result = await ask({
    prompt:
      'Given the resume bullets below (each prefixed with its id) and the job requirements, ' +
      'determine for each requirement which bullet ids (if any) provide evidence of it. ' +
      'Only cite ids that literally appear in the bullet list. If no bullet supports a ' +
      'requirement, set gap to true and leave evidenceIds empty.\n\n' +
      `--- RESUME BULLETS ---\n${bulletLines}\n\n--- REQUIREMENTS ---\n${requirementLines}`,
    schema: CoverageResultSchema,
    tools: [],
    effort: 'low',
    signal,
  });

  const knownIds = new Set(flat.map((b) => b.id));
  return filterKnownIds(result.coverage, knownIds);
}
