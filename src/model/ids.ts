import { createHash } from 'node:crypto';

export function mintEntryId(index: number): string {
  return `r${index + 1}`;
}

export function mintBulletId(entryIndex: number, bulletIndex: number): string {
  return `r${entryIndex + 1}b${bulletIndex + 1}`;
}

export function mintSkillBulletId(sectionIndex: number, bulletIndex: number): string {
  return `s${sectionIndex + 1}b${bulletIndex + 1}`;
}

/** First free `r{n}`, for an entry added after import. IDs are never reused. */
export function nextEntryId(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`r${n}`)) n += 1;
  return `r${n}`;
}

export function contentHashId(text: string): string {
  return `h${createHash('sha1').update(text).digest('hex').slice(0, 8)}`;
}
