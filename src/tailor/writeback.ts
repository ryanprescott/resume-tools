import type { Bullet, Entry, Resume } from '../model/schema.js';
import { collectKnownIds } from '../model/flatten.js';

/**
 * Promoting what you typed during a run into the base resume.
 *
 * `tailor` still never mutates the base on its own — this runs only if you say
 * yes at the end. The placement needs no further questions because the content
 * already has one: a fact that became a bullet under `r2` in the variant goes
 * under `r2` in the base.
 */

export type WritebackItem =
  | { kind: 'bullet'; id: string; text: string; section: string; entryId?: string; where: string }
  | { kind: 'entry'; entry: Entry; section: string; where: string };

function isFactId(id: string): boolean {
  return /^u\d+$/.test(id);
}

function allEntries(resume: Resume): Entry[] {
  return resume.sections.flatMap((s) => s.entries ?? []);
}

export function planWriteback(base: Resume, variant: Resume): WritebackItem[] {
  const baseIds = collectKnownIds(base).allIds;
  const baseEntryIds = new Set(allEntries(base).map((e) => e.id));
  const items: WritebackItem[] = [];

  for (const section of variant.sections) {
    for (const entry of section.entries ?? []) {
      if (!baseEntryIds.has(entry.id)) {
        items.push({
          kind: 'entry',
          entry,
          section: section.name,
          where: `${section.name} › new entry`,
        });
        continue;
      }
      for (const bullet of entry.bullets) {
        if (!isFactId(bullet.id) || baseIds.has(bullet.id)) continue;
        items.push({
          kind: 'bullet',
          id: bullet.id,
          text: bullet.text,
          section: section.name,
          entryId: entry.id,
          where: `${section.name} › ${entry.title} — ${entry.org}`,
        });
      }
    }

    for (const bullet of section.bullets ?? []) {
      if (!isFactId(bullet.id) || baseIds.has(bullet.id)) continue;
      items.push({
        kind: 'bullet',
        id: bullet.id,
        text: bullet.text,
        section: section.name,
        where: section.name,
      });
    }
  }

  return items;
}

function sectionFor(resume: Resume, name: string): Resume['sections'][number] {
  const wanted = name.trim().toLowerCase();
  const existing = resume.sections.find((s) => s.name.trim().toLowerCase() === wanted);
  if (existing) return existing;
  const created = { name, bullets: [] as Bullet[] };
  resume.sections.push(created);
  return created;
}

/** Returns a new base resume; the input is not modified. */
export function applyWriteback(base: Resume, items: ReadonlyArray<WritebackItem>): Resume {
  const next: Resume = structuredClone(base);

  for (const item of items) {
    if (item.kind === 'entry') {
      const section = sectionFor(next, item.section);
      if (section.entries) section.entries.push(item.entry);
      else if (section.bullets?.length === 0) {
        delete (section as { bullets?: Bullet[] }).bullets;
        section.entries = [item.entry];
      } else {
        console.warn(`⚠ section "${section.name}" holds bare bullets; skipped write-back of ${item.entry.id}`);
      }
      continue;
    }

    if (item.entryId) {
      const entry = allEntries(next).find((e) => e.id === item.entryId);
      if (entry) {
        entry.bullets.push({ id: item.id, text: item.text });
        continue;
      }
    }

    const section = sectionFor(next, item.section);
    if (section.bullets) section.bullets.push({ id: item.id, text: item.text });
    else if (section.entries?.length === 0) {
      delete (section as { entries?: Entry[] }).entries;
      section.bullets = [{ id: item.id, text: item.text }];
    } else {
      console.warn(`⚠ nowhere to put ${item.id} in the base resume; left it in facts.md`);
    }
  }

  return next;
}

/** Ids that landed in the base and should therefore leave the staging file. */
export function promotedFactIds(items: ReadonlyArray<WritebackItem>): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind === 'bullet') ids.add(item.id);
    else for (const bullet of item.entry.bullets) ids.add(bullet.id);
  }
  return ids;
}

/** Fact ids actually cited by the variant, for the `used:` marker in facts.md. */
export function citedFactIds(variant: Resume): Set<string> {
  const ids = new Set<string>();
  for (const id of collectKnownIds(variant).bulletIds) {
    if (isFactId(id)) ids.add(id);
  }
  return ids;
}
