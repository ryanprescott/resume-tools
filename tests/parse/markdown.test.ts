import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '../../src/parse/markdown.js';

const FRONTMATTER = `---
name: Test User
email: test@example.com
---

`;

describe('parseMarkdown grammar violations', () => {
  it('throws a line-numbered error for an entry heading missing an id comment', () => {
    const md = `${FRONTMATTER}## Experience

### Staff Engineer — Acme
2023-01 .. present · Remote

- Did a thing  <!--id:r1b1-->
`;
    expect(() => parseMarkdown(md)).toThrow(/line \d+/);
  });

  it('throws a line-numbered error for a malformed entry meta line', () => {
    const md = `${FRONTMATTER}## Experience

### Staff Engineer — Acme  <!--id:r1-->
not a valid meta line

- Did a thing  <!--id:r1b1-->
`;
    expect(() => parseMarkdown(md)).toThrow(/line \d+/);
  });

  it('throws a line-numbered error instead of silently dropping a bullet before the first entry heading', () => {
    const md = `${FRONTMATTER}## Experience

- Orphan bullet  <!--id:x1-->

### Staff Engineer — Acme  <!--id:r1-->
2023-01 .. present · Remote

- Did a thing  <!--id:r1b1-->
`;
    expect(() => parseMarkdown(md)).toThrow(/line \d+/);
  });
});

describe('parseMarkdown contact frontmatter', () => {
  const withFrontmatter = (fm: string): string => `---\n${fm}\n---\n\n## Skills\n\n- Go  <!--id:s1-->\n`;

  it('reads the headline and phone that the schema used to have nowhere to put', () => {
    const resume = parseMarkdown(
      withFrontmatter('name: Jane D\nheadline: Full Stack Developer\nemail: j@example.com\nphone: +1 (555) 010-1234'),
    );
    expect(resume.contact.headline).toBe('Full Stack Developer');
    expect(resume.contact.phone).toBe('+1 (555) 010-1234');
  });

  it('lifts a phone number parked under links by an older import', () => {
    const resume = parseMarkdown(
      withFrontmatter('name: Jane D\nemail: j@example.com\nlinks:\n  phone: +1 (555) 010-1234\n  github: https://example.com'),
    );
    expect(resume.contact.phone).toBe('+1 (555) 010-1234');
    expect(resume.contact.links).toEqual({ github: 'https://example.com' });
  });

  it('drops the links map entirely when the stray phone was its only member', () => {
    const resume = parseMarkdown(
      withFrontmatter('name: Jane D\nemail: j@example.com\nlinks:\n  phone: +1 (555) 010-1234'),
    );
    expect(resume.contact.links).toBeUndefined();
  });

  it('treats an empty location as absent, so renderers do not emit a stray separator', () => {
    const resume = parseMarkdown(withFrontmatter("name: Jane D\nemail: j@example.com\nlocation: ''"));
    expect(resume.contact.location).toBeUndefined();
  });

  it('carries the template name', () => {
    const resume = parseMarkdown(withFrontmatter('name: Jane D\nemail: j@example.com\ntemplate: sharp'));
    expect(resume.template).toBe('sharp');
  });
});

describe('parseMarkdown entry meta line', () => {
  const withEntry = (metaLine: string): string =>
    `---\nname: Jane D\nemail: j@example.com\n---\n\n## Experience\n\n### Staff Engineer — Acme  <!--id:r1-->\n${metaLine}\n\n- Did a thing  <!--id:r1b1-->\n`;

  it('accepts an entry with no location', () => {
    const entry = parseMarkdown(withEntry('2023-01 .. present')).sections[0].entries![0];
    expect(entry.end).toBe('present');
    expect(entry.location).toBeUndefined();
  });

  it('still reads a location when one is given', () => {
    const entry = parseMarkdown(withEntry('2023-01 .. present · Remote')).sections[0].entries![0];
    expect(entry.location).toBe('Remote');
  });

  it('tolerates the trailing separator left by earlier imports', () => {
    const entry = parseMarkdown(withEntry('Jan-2025 .. Present · ')).sections[0].entries![0];
    expect(entry.end).toBe('Present');
    expect(entry.location).toBeUndefined();
  });

  it('serializes a locationless entry without a dangling separator', () => {
    const md = serializeMarkdown(parseMarkdown(withEntry('2023-01 .. present')));
    expect(md).toContain('2023-01 .. present\n');
    expect(md).not.toContain('present ·');
  });
});

describe('parseMarkdown content-hash ids', () => {
  it('derives a stable id for a bullet lacking an id comment, across repeated parses', () => {
    const md = `${FRONTMATTER}## Skills

- Languages: TypeScript, Go, Python
`;
    const r1 = parseMarkdown(md);
    const r2 = parseMarkdown(md);
    const id1 = r1.sections[0].bullets?.[0].id;
    const id2 = r2.sections[0].bullets?.[0].id;
    expect(id1).toBeDefined();
    expect(id1).toBe(id2);
  });
});
