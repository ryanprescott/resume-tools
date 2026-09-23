import matter from 'gray-matter';
import { ResumeSchema, type Resume, type Section, type Entry, type Bullet } from '../model/schema.js';
import { contentHashId } from '../model/ids.js';

/**
 * Carries enough to show you the problem rather than just assert it: which
 * line, what was on it, and — since the commonest way to hit this is pointing
 * a command at a file that was never a resume — whether the file looks like
 * one at all.
 */
export class ResumeParseError extends Error {
  constructor(
    readonly line: number,
    readonly lineText: string,
    readonly detail: string,
  ) {
    super(`line ${line}: ${detail}`);
    this.name = 'ResumeParseError';
  }
}

/**
 * Frontmatter with a `name`, or at least one `## Section`. A job description,
 * a README or a plain text file has neither, and saying so is far more use
 * than reporting a syntax error on line 1.
 */
export function looksLikeResume(md: string): boolean {
  const parsed = matter(md);
  if (typeof parsed.data.name === 'string' && parsed.data.name.trim() !== '') return true;
  return parsed.content.split('\n').some((line) => /^## \S/.test(line));
}

function err(lineNum: number, message: string, lineText = ''): Error {
  return new ResumeParseError(lineNum, lineText, message);
}

function stripIdComment(text: string): { text: string; id: string | null } {
  const m = text.match(/^(.*?)\s*<!--id:([^\s>]+)-->\s*$/);
  if (m) {
    return { text: m[1].trimEnd(), id: m[2] };
  }
  return { text: text.trimEnd(), id: null };
}

/**
 * Earlier imports had no `phone` field and parked the number under `links`,
 * where it renders as a broken anchor. Lift it back out on the way in so old
 * files keep working and re-serialize cleanly.
 */
function normalizeContact(data: Record<string, unknown>): {
  phone: unknown;
  links: Record<string, string> | undefined;
} {
  const links = data.links as Record<string, string> | undefined;
  if (!links || !('phone' in links)) return { phone: data.phone, links };

  const { phone: strayPhone, ...rest } = links;
  return {
    phone: data.phone ?? strayPhone,
    links: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

export function parseMarkdown(md: string): Resume {
  const parsed = matter(md);
  const offset = md.length - parsed.content.length;
  const lineOffset = md.slice(0, offset).split('\n').length - 1;
  const bodyLines = parsed.content.split('\n');

  const { phone, links } = normalizeContact(parsed.data);
  const contact = {
    name: parsed.data.name,
    headline: parsed.data.headline,
    email: parsed.data.email,
    phone,
    location: parsed.data.location,
    links,
  };
  const meta = parsed.data.meta;
  const template = parsed.data.template;

  const sections: Section[] = [];
  let currentSectionName: string | null = null;
  let currentEntries: Entry[] = [];
  let currentBullets: Bullet[] = [];
  let currentEntry: Entry | null = null;
  let expectingEntryMeta = false;
  let currentSectionKind: 'entries' | 'bullets' | null = null;

  function closeSection(): void {
    if (currentSectionName === null) return;
    if (currentEntry) {
      currentEntries.push(currentEntry);
      currentEntry = null;
    }
    if (currentSectionKind === 'bullets') {
      sections.push({ name: currentSectionName, bullets: currentBullets });
    } else {
      sections.push({ name: currentSectionName, entries: currentEntries });
    }
    currentEntries = [];
    currentBullets = [];
    currentSectionKind = null;
  }

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const lineNum = lineOffset + i + 1;

    if (line.trim() === '') continue;

    if (expectingEntryMeta) {
      const metaMatch = line.match(/^(\S+)\s*\.\.\s*(\S+?)(?:\s*·\s*(.*))?$/);
      if (!metaMatch) {
        throw err(lineNum, "expected entry meta line '{start} .. {end}' with optional ' · {location}'", line);
      }
      currentEntry!.start = metaMatch[1];
      currentEntry!.end = metaMatch[2];
      currentEntry!.location = metaMatch[3]?.trim();
      expectingEntryMeta = false;
      continue;
    }

    const sectionMatch = line.match(/^## (.+)$/);
    if (sectionMatch) {
      closeSection();
      currentSectionName = sectionMatch[1].trim();
      continue;
    }

    const entryMatch = line.match(/^### (.+)$/);
    if (entryMatch) {
      if (currentSectionName === null) throw err(lineNum, 'entry heading outside of a section', line);
      if (currentSectionKind === 'bullets') {
        throw err(lineNum, 'entry heading not allowed in a section that already contains bare bullets', line);
      }
      currentSectionKind = 'entries';
      if (currentEntry) {
        currentEntries.push(currentEntry);
        currentEntry = null;
      }
      const stripped = stripIdComment(entryMatch[1]);
      if (!stripped.id) throw err(lineNum, 'entry heading missing id comment', line);
      const parts = stripped.text.split(' — ');
      if (parts.length !== 2) throw err(lineNum, 'expected entry heading "{title} — {org}"', line);
      currentEntry = { id: stripped.id, title: parts[0], org: parts[1], start: '', end: '', location: '', bullets: [] };
      expectingEntryMeta = true;
      continue;
    }

    const bulletMatch = line.match(/^- (.*)$/);
    if (bulletMatch) {
      if (currentSectionName === null) throw err(lineNum, 'bullet outside of a section', line);
      if (currentSectionKind === 'entries' && !currentEntry) {
        throw err(lineNum, 'bullet does not belong to any entry in this entries-style section', line);
      }
      const stripped = stripIdComment(bulletMatch[1]);
      const id = stripped.id ?? contentHashId(stripped.text);
      const bullet: Bullet = { id, text: stripped.text };
      if (currentEntry) {
        currentEntry.bullets.push(bullet);
      } else {
        currentSectionKind = 'bullets';
        currentBullets.push(bullet);
      }
      continue;
    }

    throw err(lineNum, 'unrecognized syntax', line);
  }

  if (expectingEntryMeta) {
    throw err(
      lineOffset + bodyLines.length,
      "expected entry meta line '{start} .. {end}' with optional ' · {location}'",
    );
  }
  closeSection();

  const resume = { contact, meta, template, sections };
  const result = ResumeSchema.safeParse(resume);
  if (!result.success) {
    throw new Error(`invalid resume: ${result.error.message}`);
  }
  return result.data;
}

function renderEntryBlock(entry: Entry): string {
  const lines: string[] = [];
  lines.push(`### ${entry.title} — ${entry.org}  <!--id:${entry.id}-->`);
  const range = `${entry.start} .. ${entry.end}`;
  lines.push(entry.location ? `${range} · ${entry.location}` : range);
  lines.push('');
  for (const bullet of entry.bullets) {
    lines.push(`- ${bullet.text}  <!--id:${bullet.id}-->`);
  }
  return lines.join('\n');
}

function renderSection(section: Section): string {
  const lines: string[] = [`## ${section.name}`, ''];
  if (section.entries !== undefined) {
    lines.push(section.entries.map(renderEntryBlock).join('\n\n'));
  } else {
    const bullets = section.bullets ?? [];
    lines.push(bullets.map((b) => `- ${b.text}  <!--id:${b.id}-->`).join('\n'));
  }
  return lines.join('\n');
}

export function serializeMarkdown(resume: Resume): string {
  const frontmatter: Record<string, unknown> = { name: resume.contact.name };
  if (resume.contact.headline !== undefined) frontmatter.headline = resume.contact.headline;
  if (resume.contact.email !== undefined) frontmatter.email = resume.contact.email;
  if (resume.contact.phone !== undefined) frontmatter.phone = resume.contact.phone;
  if (resume.contact.location !== undefined) frontmatter.location = resume.contact.location;
  if (resume.contact.links !== undefined) frontmatter.links = resume.contact.links;
  if (resume.template !== undefined) frontmatter.template = resume.template;
  if (resume.meta !== undefined) frontmatter.meta = resume.meta;

  const body = resume.sections.map(renderSection).join('\n\n');
  const content = `\n${body}\n`;

  return matter.stringify(content, frontmatter);
}
