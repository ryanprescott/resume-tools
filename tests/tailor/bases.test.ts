import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarkdown, serializeMarkdown } from '../../src/parse/markdown.js';
import { asOccupationBase, loadBases, newBasePath, occupationOf } from '../../src/tailor/bases.js';
import { withAdditions } from '../../src/tailor/apply.js';
import { describeBase, resolveRoute } from '../../src/tailor/route.js';
import type { Resume } from '../../src/model/schema.js';

const ROOT = `---
name: Jane D
headline: Full Stack Developer
---

## Skills

- TypeScript, Go  <!--id:s1b1-->

## Experience

### Engineer — Acme  <!--id:r1-->
2022-03 .. present

- Built the ledger  <!--id:r1b1-->
`;

function variant(basedOn: string, title: string, company?: string): string {
  const resume = parseMarkdown(ROOT);
  resume.meta = { basedOn, job: { title, ...(company ? { company } : {}) } };
  return serializeMarkdown(resume);
}

let dir: string;
let root: { path: string; resume: Resume };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-tools-bases-'));
  await mkdir(join(dir, 'bases'));
  await mkdir(join(dir, 'variants'));
  root = { path: join(dir, 'base.resume.md'), resume: parseMarkdown(ROOT) };

  const it = parseMarkdown(ROOT);
  it.meta = { basedOn: 'base.resume.md', occupation: 'IT Support' };
  await writeFile(join(dir, 'bases', 'it-support.resume.md'), serializeMarkdown(it));
  await writeFile(join(dir, 'bases', 'broken.resume.md'), '## Oops\n\nnot a resume line\n');

  await writeFile(join(dir, 'variants', 'a.resume.md'), variant('base.resume.md', 'Staff Engineer', 'Acme'));
  await writeFile(join(dir, 'variants', 'b.resume.md'), variant('it-support.resume.md', 'Help Desk Lead'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadBases', () => {
  it('puts the root first, reads occupations, and counts the jobs each has served', async () => {
    const warnings: string[] = [];
    const bases = await loadBases(root, join(dir, 'bases'), join(dir, 'variants'), (w) => warnings.push(w));

    expect(bases.map((b) => b.occupation)).toEqual(['Full Stack Developer', 'IT Support']);
    expect(bases[0].usedFor).toEqual(['Staff Engineer at Acme']);
    expect(bases[1].usedFor).toEqual(['Help Desk Lead']);
    expect(warnings).toEqual([expect.stringMatching(/broken\.resume\.md/)]);
  });

  it('offers only the root when the base was pinned with --from', async () => {
    const bases = await loadBases(root, null, join(dir, 'variants'));
    expect(bases).toHaveLength(1);
  });
});

describe('occupation bases', () => {
  it('prefers the declared occupation over the headline', () => {
    const r = parseMarkdown(ROOT);
    expect(occupationOf(r)).toBe('Full Stack Developer');
    r.meta = { occupation: 'IT Support' };
    expect(occupationOf(r)).toBe('IT Support');
  });

  it('never overwrites an existing base', async () => {
    expect(await newBasePath(join(dir, 'bases'), 'IT Support')).toBe(join(dir, 'bases', 'it-support-2.resume.md'));
    expect(await newBasePath(join(dir, 'bases'), 'Nurse (RN)')).toBe(join(dir, 'bases', 'nurse-rn.resume.md'));
  });

  it('turns a pivoted variant into a base: occupation in, job out, headline set', () => {
    const v = parseMarkdown(variant('base.resume.md', 'Help Desk Lead', 'Acme'));
    const base = asOccupationBase(v, 'IT Support', 'IT Support Specialist', 'base.resume.md');
    expect(base.meta).toEqual({ basedOn: 'base.resume.md', occupation: 'IT Support' });
    expect(base.contact.headline).toBe('IT Support Specialist');
    expect(v.meta?.job?.title).toBe('Help Desk Lead');

    // …and round-trips through the file format.
    expect(parseMarkdown(serializeMarkdown(base))).toEqual(base);
  });

  it('adds related roles to a copy, leaving the base alone', () => {
    const entry = { id: 'r9', title: 'Help desk technician', org: 'Library', start: '2019', end: '2020', bullets: [] };
    const out = withAdditions(root.resume, [{ kind: 'entry', section: 'Experience', entry }]);
    expect(out.sections[1].entries?.map((e) => e.id)).toEqual(['r1', 'r9']);
    expect(root.resume.sections[1].entries).toHaveLength(1);
  });
});

describe('routing', () => {
  it('shows the model each base by key, with what it has been used for', () => {
    const text = describeBase({ ...root, occupation: 'Full Stack Developer', usedFor: ['Staff Engineer at Acme'] }, 0);
    expect(text).toMatch(/^\[b1\] occupation: Full Stack Developer/);
    expect(text).toMatch(/Experience: Engineer — Acme/);
    expect(text).toMatch(/already tailored for: Staff Engineer at Acme/);
  });

  it('maps keys back to bases, falling back to the first on nonsense', () => {
    const raw = { fit: 'none' as const, reason: '', relatedRoles: [' Help desk ', 'Help desk', ''] };
    expect(resolveRoute({ ...raw, baseKey: 'b2' }, 2).baseIndex).toBe(1);
    expect(resolveRoute({ ...raw, baseKey: '[b2]' }, 2).baseIndex).toBe(1);
    expect(resolveRoute({ ...raw, baseKey: 'b7' }, 2).baseIndex).toBe(0);
    expect(resolveRoute({ ...raw, baseKey: 'resumes/x.md' }, 2).baseIndex).toBe(0);
    expect(resolveRoute({ ...raw, baseKey: 'b1' }, 2).relatedRoles).toEqual(['Help desk']);
  });
});
