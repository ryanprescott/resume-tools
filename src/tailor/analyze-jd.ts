import { ask } from '../claude.js';
import { JobSpecSchema, type JobSpec } from './types.js';

export async function analyzeJd(jdText: string, signal?: AbortSignal): Promise<JobSpec> {
  return ask({
    prompt:
      'Analyze the following job description and extract a structured summary of it. ' +
      '"hardRequirements" are must-have qualifications explicitly stated as required. ' +
      '"niceToHaves" are qualifications described as a plus/preferred/bonus. ' +
      '"keywords" are the specific technologies, tools, and terms an ATS or recruiter would ' +
      'search for (include both hard requirements and nice-to-haves phrased as short terms). ' +
      '"domain" is the industry/problem domain (e.g. "fintech", "developer tooling"). ' +
      '"company" is the hiring company\'s name exactly as the text gives it — the client, not a ' +
      'staffing agency, when both appear — or "" if the text does not name it. ' +
      '"recruiter" is the full name of the recruiter or hiring contact the text names, or "" if ' +
      'none is named; never a company or a team. ' +
      '"occupation" is the general occupation this role belongs to, without seniority, level or ' +
      'team — e.g. "Software Engineer", "Blockchain Infrastructure Engineer", "Registered Nurse", ' +
      '"Product Manager". ' +
      'Do not add requirements that are not stated in the text.\n\n' +
      `--- JOB DESCRIPTION ---\n${jdText}`,
    schema: JobSpecSchema,
    tools: [],
    effort: 'low',
    signal,
  });
}
