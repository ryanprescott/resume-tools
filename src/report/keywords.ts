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
  return parts.join(' ').toLowerCase();
}

export function renderKeywordReport(job: JobSpec, resume: Resume): string {
  const text = resumeText(resume);
  const present = job.keywords.filter((k) => text.includes(k.toLowerCase()));
  const absent = job.keywords.filter((k) => !text.includes(k.toLowerCase()));

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
