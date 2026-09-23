import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * User-supplied facts — the third source class, alongside the base resume and
 * the job description.
 *
 * The no-fabrication rule says a proposed bullet must cite an antecedent. It
 * does not say the only possible antecedent is the base resume: if you tell the
 * tool you ran the Kubernetes migration, that is source material, and the
 * verifier should accept a bullet derived from it. What the rule actually
 * forbids is the *model* inventing claims, and that is unchanged — facts only
 * ever enter through you typing them.
 *
 * Facts live in `resumes/facts.md` rather than the variant so they accumulate
 * across applications. A fact promoted into the base resume is removed from the
 * file: the file is a staging area for claims not yet in the resume, so a fact
 * is in exactly one place and its id never denotes two different things.
 */

export const FACTS_PATH = 'resumes/facts.md';

export interface Fact {
  id: string;
  text: string;
  /** Job slugs this fact has been used in, oldest first. */
  usedIn: string[];
}

const HEADER = `# Facts

Claims about your own experience captured while tailoring, which were not in the
base resume. Tailored variants cite these by id. Edit or delete lines freely —
this file is read at the start of every \`tailor\` run and offered as source
material for the job at hand.
`;

const FACT_LINE = /^-\s+(.*)$/;
const ID_COMMENT = /\s*<!--id:(u\d+)-->/;
const USED_COMMENT = /\s*<!--used:([^>]*)-->/;

export function parseFacts(markdown: string): Fact[] {
  const facts: Fact[] = [];
  let autoId = 0;

  for (const rawLine of markdown.split('\n')) {
    const match = rawLine.trim().match(FACT_LINE);
    if (!match) continue;

    let text = match[1];
    const usedMatch = text.match(USED_COMMENT);
    const usedIn = usedMatch
      ? usedMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (usedMatch) text = text.replace(USED_COMMENT, '');

    const idMatch = text.match(ID_COMMENT);
    if (idMatch) text = text.replace(ID_COMMENT, '');

    text = text.trim();
    if (text === '') continue;

    // A line you hand-added without an id still gets one, so it is citable on
    // this run; it is written back with the id so it stays stable afterwards.
    autoId += 1;
    facts.push({ id: idMatch ? idMatch[1] : `u${autoId}`, text, usedIn });
  }

  return dedupeIds(facts);
}

/** Hand-edited files can repeat an id; the later one is renumbered, not dropped. */
function dedupeIds(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.map((fact) => {
    if (!seen.has(fact.id)) {
      seen.add(fact.id);
      return fact;
    }
    const id = nextId(seen);
    seen.add(id);
    return { ...fact, id };
  });
}

function nextId(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`u${n}`)) n += 1;
  return `u${n}`;
}

export function mintFactId(existing: ReadonlyArray<Fact>): string {
  return nextId(new Set(existing.map((f) => f.id)));
}

export function serializeFacts(facts: ReadonlyArray<Fact>): string {
  if (facts.length === 0) return HEADER;
  const lines = facts.map((fact) => {
    const used = fact.usedIn.length > 0 ? `  <!--used:${fact.usedIn.join(',')}-->` : '';
    return `- ${fact.text}  <!--id:${fact.id}-->${used}`;
  });
  return `${HEADER}\n${lines.join('\n')}\n`;
}

export async function loadFacts(path = FACTS_PATH): Promise<Fact[]> {
  try {
    return parseFacts(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveFacts(facts: ReadonlyArray<Fact>, path = FACTS_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeFacts(facts), 'utf8');
}

/**
 * Holds the facts for one run: those loaded from disk plus any captured while
 * it is going. Minting goes through here so an id issued during the gap
 * interview cannot be handed out again during review.
 */
export class FactStore {
  private readonly facts: Fact[];
  private readonly fresh: Fact[] = [];

  constructor(initial: ReadonlyArray<Fact> = []) {
    this.facts = [...initial];
  }

  all(): ReadonlyArray<Fact> {
    return this.facts;
  }

  /** Facts captured during this run — the ones worth offering to write back. */
  added(): ReadonlyArray<Fact> {
    return this.fresh;
  }

  ids(): Set<string> {
    return new Set(this.facts.map((f) => f.id));
  }

  get(id: string): Fact | undefined {
    return this.facts.find((f) => f.id === id);
  }

  add(text: string): Fact {
    const fact: Fact = { id: mintFactId(this.facts), text: text.trim(), usedIn: [] };
    this.facts.push(fact);
    this.fresh.push(fact);
    return fact;
  }

  /** Amend a fact in place, keeping its id so anything citing it still resolves. */
  update(id: string, text: string): void {
    for (const list of [this.facts, this.fresh]) {
      const fact = list.find((f) => f.id === id);
      if (fact) fact.text = text.trim();
    }
  }

  /**
   * Drop a fact captured this run. Only used when you go back and unpick an
   * answer — a fact loaded from disk is not this stage's to delete.
   */
  remove(id: string): void {
    if (!this.fresh.some((f) => f.id === id)) return;
    for (const list of [this.facts, this.fresh]) {
      const index = list.findIndex((f) => f.id === id);
      if (index >= 0) list.splice(index, 1);
    }
  }
}

/** Record that `ids` were cited by the run for `slug`, without duplicating. */
export function markUsed(facts: ReadonlyArray<Fact>, ids: ReadonlySet<string>, slug: string): Fact[] {
  return facts.map((fact) =>
    ids.has(fact.id) && !fact.usedIn.includes(slug)
      ? { ...fact, usedIn: [...fact.usedIn, slug] }
      : fact,
  );
}
