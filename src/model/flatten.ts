import type { Resume } from './schema.js';

export interface FlatBullet {
  id: string;
  text: string;
  context: string;
}

export function flattenBullets(resume: Resume): FlatBullet[] {
  const flat: FlatBullet[] = [];
  for (const section of resume.sections) {
    if (section.entries !== undefined) {
      for (const entry of section.entries) {
        const context = `${entry.title} — ${entry.org}`;
        for (const bullet of entry.bullets) {
          flat.push({ id: bullet.id, text: bullet.text, context });
        }
      }
    } else {
      for (const bullet of section.bullets ?? []) {
        flat.push({ id: bullet.id, text: bullet.text, context: section.name });
      }
    }
  }
  return flat;
}

export interface Located {
  sectionName: string;
  /** `Staff Engineer — Acme`, absent for a bare bullet in a Skills-style section. */
  entryLabel?: string;
  /** The entry a bullet lives under, or the entry itself when `id` is an entry. */
  entryId?: string;
}

/** Where an id sits in the document, for showing context in the review UI. */
export function locate(resume: Resume, id: string): Located | null {
  for (const section of resume.sections) {
    if (section.entries !== undefined) {
      for (const entry of section.entries) {
        const label = `${entry.title} — ${entry.org}`;
        if (entry.id === id) {
          return { sectionName: section.name, entryLabel: label, entryId: entry.id };
        }
        if (entry.bullets.some((b) => b.id === id)) {
          return { sectionName: section.name, entryLabel: label, entryId: entry.id };
        }
      }
    } else if (section.bullets?.some((b) => b.id === id)) {
      return { sectionName: section.name };
    }
  }
  return null;
}

export function describeLocation(resume: Resume, id: string): string {
  const at = locate(resume, id);
  if (!at) return id;
  return at.entryLabel ? `${at.sectionName} › ${at.entryLabel}` : at.sectionName;
}

export interface KnownIds {
  bulletIds: Set<string>;
  allIds: Set<string>;
}

export function collectKnownIds(resume: Resume): KnownIds {
  const bulletIds = new Set(flattenBullets(resume).map((b) => b.id));
  const allIds = new Set(bulletIds);
  for (const section of resume.sections) {
    for (const entry of section.entries ?? []) {
      allIds.add(entry.id);
    }
  }
  return { bulletIds, allIds };
}
