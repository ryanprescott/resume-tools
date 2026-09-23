import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ask } from '../claude.js';
import { ContactSchema, ResumeSchema, type Resume } from '../model/schema.js';
import { mintBulletId, mintEntryId, mintSkillBulletId } from '../model/ids.js';
import { reconstructTemplate, type ReconstructedTemplate } from './template.js';

const execFileAsync = promisify(execFile);

const ExtractedBulletSchema = z.object({ text: z.string() });

const ExtractedEntrySchema = z.object({
  title: z.string(),
  org: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string(),
  bullets: z.array(ExtractedBulletSchema),
});

const ExtractedSectionSchema = z
  .object({
    name: z.string(),
    entries: z.array(ExtractedEntrySchema).optional(),
    bullets: z.array(ExtractedBulletSchema).optional(),
  })
  .superRefine((section, ctx) => {
    const hasEntries = section.entries !== undefined;
    const hasBullets = section.bullets !== undefined;
    if (hasEntries === hasBullets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `section "${section.name}" must have exactly one of "entries" or "bullets"`,
      });
    }
  });

const ExtractedResumeSchema = z.object({
  contact: ContactSchema,
  sections: z.array(ExtractedSectionSchema),
});

export interface ImportResult {
  resume: Resume;
  template: ReconstructedTemplate;
  discrepancies: string[];
}

// The markdown grammar's entry meta line ({start} .. {end} · {location}) requires
// start/end to be single whitespace-free tokens; PDFs commonly render dates like "Jan 2025".
function normalizeDateToken(value: string): string {
  return value.trim().replace(/\s+/g, '-');
}

export async function importPdf(pdfPath: string, templateName: string): Promise<ImportResult> {
  const absPath = resolve(pdfPath);

  // Content and layout are separate passes: they answer different questions, and
  // asking for both at once reliably degrades the transcription.
  const extracted = await ask({
    prompt:
      `Read the resume PDF at ${absPath} and extract its contact information and content into ` +
      'the structured schema. Transcribe every section, entry, and bullet faithfully — never ' +
      'invent, summarize away, or drop content, and never add content that is not in the PDF. ' +
      'Capture the full contact block: name, the professional title or headline printed near ' +
      'the name (e.g. "Full Stack Developer"), email, phone number, location, and any profile ' +
      'URLs. Put the phone number in the phone field and reserve links for URLs. ' +
      'Every entry needs both a start and an end date; for a single-date entry (e.g. one ' +
      'certificate date, one-off engagement), set end equal to start rather than leaving it blank.',
    schema: ExtractedResumeSchema,
    tools: ['Read'],
    effort: 'low',
  });

  let entryIndex = 0;
  let bulletSectionIndex = 0;
  const sections = extracted.sections.map((section) => {
    if (section.entries !== undefined) {
      const entries = section.entries.map((entry) => {
        const id = mintEntryId(entryIndex);
        const bullets = entry.bullets.map((bullet, j) => ({
          id: mintBulletId(entryIndex, j),
          text: bullet.text,
        }));
        entryIndex++;
        const start = normalizeDateToken(entry.start);
        const end = entry.end.trim() === '' ? start : normalizeDateToken(entry.end);
        return { id, title: entry.title, org: entry.org, start, end, location: entry.location, bullets };
      });
      return { name: section.name, entries };
    }

    const bullets = (section.bullets ?? []).map((bullet, j) => ({
      id: mintSkillBulletId(bulletSectionIndex, j),
      text: bullet.text,
    }));
    bulletSectionIndex++;
    return { name: section.name, bullets };
  });

  const resume = ResumeSchema.parse({
    contact: extracted.contact,
    meta: undefined,
    template: templateName,
    sections,
  });

  // The layout pass runs second because its output is verified by rendering it
  // against this resume — it needs the real content to prove it drops nothing.
  const template = await reconstructTemplate(absPath, resume);

  const { stdout } = await execFileAsync('pdftotext', ['-layout', absPath, '-']);
  const discrepancies = checkCoverage(stdout, resume);

  return { resume, template, discrepancies };
}

export function checkCoverage(pdfText: string, resume: Resume): string[] {
  const { contact } = resume;
  const resumeParts: string[] = [contact.name];
  for (const value of [contact.headline, contact.email, contact.phone, contact.location]) {
    if (value) resumeParts.push(value);
  }
  if (contact.links) resumeParts.push(...Object.values(contact.links));
  for (const section of resume.sections) {
    for (const entry of section.entries ?? []) {
      resumeParts.push(entry.title, entry.org);
      if (entry.location) resumeParts.push(entry.location);
      for (const bullet of entry.bullets) resumeParts.push(bullet.text);
    }
    for (const bullet of section.bullets ?? []) resumeParts.push(bullet.text);
  }
  const resumeText = resumeParts.join(' ').toLowerCase().replace(/\s+/g, ' ');

  const discrepancies: string[] = [];
  for (const rawLine of pdfText.split('\n')) {
    const line = rawLine.trim();
    if (line.length <= 15) continue;

    const words = line
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const uniqueWords = [...new Set(words)];
    if (uniqueWords.length < 3) continue;

    const present = uniqueWords.filter((w) => resumeText.includes(w)).length;
    const fraction = present / uniqueWords.length;
    if (fraction < 0.6) {
      discrepancies.push(line);
    }
  }

  return discrepancies;
}
