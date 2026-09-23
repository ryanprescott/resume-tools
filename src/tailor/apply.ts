import type { Bullet, Entry, Resume, Section } from '../model/schema.js';
import { contentHashId } from '../model/ids.js';
import { collectKnownIds } from '../model/flatten.js';
import type { Addition, Decision } from './types.js';

function moveToFront<T>(arr: T[], index: number): void {
  const [item] = arr.splice(index, 1);
  arr.unshift(item);
}

function moveToBack<T>(arr: T[], index: number): void {
  const [item] = arr.splice(index, 1);
  arr.push(item);
}

function swapWithPrevious<T>(arr: T[], index: number): void {
  if (index <= 0) return;
  [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
}

function findBulletSiblings(sections: Section[], id: string): Bullet[] | null {
  for (const section of sections) {
    if (section.entries !== undefined) {
      for (const entry of section.entries) {
        if (entry.bullets.some((b) => b.id === id)) return entry.bullets;
      }
    } else if (section.bullets?.some((b) => b.id === id)) {
      return section.bullets;
    }
  }
  return null;
}

function findEntrySiblings(sections: Section[], id: string): Entry[] | null {
  for (const section of sections) {
    if (section.entries?.some((e) => e.id === id)) return section.entries;
  }
  return null;
}

function findEntry(sections: Section[], id: string): Entry | null {
  for (const section of sections) {
    for (const entry of section.entries ?? []) {
      if (entry.id === id) return entry;
    }
  }
  return null;
}

function findSection(sections: Section[], name: string): Section | null {
  const wanted = name.trim().toLowerCase();
  return sections.find((s) => s.name.trim().toLowerCase() === wanted) ?? null;
}

/**
 * A bullet added from a user fact keeps the fact's id (`u3`), so the variant
 * records on its face where the claim came from and a later write-back into the
 * base resume does not have to renumber anything. If that id is somehow already
 * in use, fall back to the content hash the Markdown parser would have minted.
 */
export function newBulletId(text: string, sourceIds: readonly string[], taken: ReadonlySet<string>): string {
  const factId = sourceIds.find((id) => /^u\d+$/.test(id));
  if (factId && !taken.has(factId)) return factId;
  const hashed = contentHashId(text);
  if (!taken.has(hashed)) return hashed;
  let n = 2;
  while (taken.has(`${hashed}-${n}`)) n += 1;
  return `${hashed}-${n}`;
}

/**
 * Structural additions on their own — whole entries, list lines — onto a copy
 * of `resume`. A pivot adds the related roles you describe *before* anything
 * is suggested, so the suggestions can work on them like any other entry.
 */
export function withAdditions(resume: Resume, additions: ReadonlyArray<Addition>): Resume {
  const clone: Resume = structuredClone(resume);
  appendAdditions(clone, additions);
  return clone;
}

function appendAdditions(clone: Resume, additions: ReadonlyArray<Addition>): void {
  for (const addition of additions) {
    const existing = findSection(clone.sections, addition.section);

    if (addition.kind === 'entry') {
      if (existing?.entries) {
        existing.entries.push(addition.entry);
      } else if (!existing) {
        clone.sections.push({ name: addition.section, entries: [addition.entry] });
      } else {
        console.warn(`⚠ section "${existing.name}" holds bare bullets; skipped a new entry for it`);
      }
      continue;
    }

    if (existing?.bullets) {
      existing.bullets.push(addition.bullet);
    } else if (!existing) {
      clone.sections.push({ name: addition.section, bullets: [addition.bullet] });
    } else {
      console.warn(`⚠ section "${existing.name}" holds entries; skipped a bare bullet for it`);
    }
  }
}

export function applyDecisions(
  resume: Resume,
  decisions: Decision[],
  job: { company?: string; title: string; recruiter?: string },
  basedOnRef: string,
  additions: ReadonlyArray<Addition> = [],
): Resume {
  const clone: Resume = structuredClone(resume);
  const taken = new Set(collectKnownIds(clone).allIds);

  for (const { suggestion, action, editedText } of decisions) {
    if (action === 'reject' || action === 'skip') continue;

    const { targetId, kind } = suggestion;
    const text = action === 'edit' ? (editedText ?? suggestion.after) : suggestion.after;

    if (kind === 'add') {
      const bullet: Bullet = { id: newBulletId(text, suggestion.sourceIds, taken), text };
      taken.add(bullet.id);

      // targetId is either the entry the bullet belongs under, or a sibling
      // bullet to slot in after — the latter is how a Skills-style section,
      // which has no entries, gets a new line.
      const entry = findEntry(clone.sections, targetId);
      if (entry) {
        entry.bullets.push(bullet);
        continue;
      }
      const siblings = findBulletSiblings(clone.sections, targetId);
      if (siblings) {
        const idx = siblings.findIndex((b) => b.id === targetId);
        siblings.splice(idx + 1, 0, bullet);
      }
      continue;
    }

    if (kind === 'rewrite') {
      const siblings = findBulletSiblings(clone.sections, targetId);
      const bullet = siblings?.find((b) => b.id === targetId);
      if (bullet) bullet.text = text;
      continue;
    }

    if (kind === 'drop') {
      const bulletSiblings = findBulletSiblings(clone.sections, targetId);
      if (bulletSiblings) {
        const idx = bulletSiblings.findIndex((b) => b.id === targetId);
        if (idx >= 0) bulletSiblings.splice(idx, 1);
        continue;
      }
      const entrySiblings = findEntrySiblings(clone.sections, targetId);
      if (entrySiblings) {
        const idx = entrySiblings.findIndex((e) => e.id === targetId);
        if (idx >= 0) entrySiblings.splice(idx, 1);
      }
      continue;
    }

    if (kind === 'promote' || kind === 'demote' || kind === 'reorder') {
      const bulletSiblings = findBulletSiblings(clone.sections, targetId);
      const siblings = (bulletSiblings ?? findEntrySiblings(clone.sections, targetId)) as
        | Array<{ id: string }>
        | null;
      if (!siblings) continue;
      const idx = siblings.findIndex((item) => item.id === targetId);
      if (idx < 0) continue;
      if (kind === 'promote') moveToFront(siblings, idx);
      else if (kind === 'demote') moveToBack(siblings, idx);
      else swapWithPrevious(siblings, idx);
    }
  }

  appendAdditions(clone, additions);

  // Absent fields stay absent, rather than being written out as `company: null`.
  clone.meta = {
    basedOn: basedOnRef,
    job: {
      title: job.title,
      ...(job.company ? { company: job.company } : {}),
      ...(job.recruiter ? { recruiter: job.recruiter } : {}),
    },
  };
  return clone;
}
