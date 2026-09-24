import { flattenBullets } from '../model/flatten.js';
import type { Resume } from '../model/schema.js';
import type { JobSpec } from '../tailor/types.js';

function resumeText(resume: Resume): string {
  const { contact } = resume;
  const parts: string[] = [contact.name];
  for (const value of [contact.headline, contact.email, contact.location]) {
    if (value) parts.push(value);
  }
  if (contact.links) parts.push(...Object.values(contact.links));
  for (const bullet of flattenBullets(resume)) parts.push(bullet.text, bullet.context);
  return parts.join(' ');
}

/**
 * Whether `keyword` appears in `text` as a term rather than inside a longer
 * word. A plain substring test reports "CIS" present in any resume that says
 * "Cisco", and "EMS" in any that says "systems" — the report is only worth
 * reading if Present means present. Spaces, hyphens and slashes inside a
 * keyword are interchangeable, so "full-stack" matches "full stack".
 */
export function containsKeyword(text: string, keyword: string): boolean {
  const words = keyword.trim().split(/[\s\-/]+/).filter(Boolean);
  if (words.length === 0) return false;
  const body = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-/]+');
  // A plural still counts: "configuration" is in a resume that says "configurations".
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?:e?s)?(?![\\p{L}\\p{N}+#])`, 'iu').test(text);
}

export function renderKeywordReport(job: JobSpec, resume: Resume): string {
  const text = resumeText(resume);
  const present = job.keywords.filter((k) => containsKeyword(text, k));
  const absent = job.keywords.filter((k) => !containsKeyword(text, k));

  const lines: string[] = [];
  lines.push(`# Keyword coverage — ${job.title}`);
  lines.push('');

  lines.push('## Present');
  lines.push('');
  if (present.length === 0) {
    lines.push('(none)');
  } else {
    for (const k of present) lines.push(`- ${k}`);
  }
  lines.push('');

  lines.push('## Absent');
  lines.push('');
  if (absent.length === 0) {
    lines.push('(none)');
  } else {
    for (const k of absent) lines.push(`- ${k}`);
  }
  lines.push('');

  return lines.join('\n');
}
