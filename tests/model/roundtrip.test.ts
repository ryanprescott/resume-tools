import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseMarkdown, serializeMarkdown } from '../../src/parse/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'fixtures', 'sample.resume.md');

describe('markdown round-trip', () => {
  it('is a fixed point: parse(serialize(parse(x))) equals parse(x)', async () => {
    const raw = await readFile(fixturePath, 'utf8');
    const r1 = parseMarkdown(raw);
    const md2 = serializeMarkdown(r1);
    const r2 = parseMarkdown(md2);
    expect(r2).toEqual(r1);
  });

  it('serialize is idempotent on the second pass', async () => {
    const raw = await readFile(fixturePath, 'utf8');
    const r1 = parseMarkdown(raw);
    const md2 = serializeMarkdown(r1);
    const r2 = parseMarkdown(md2);
    const md3 = serializeMarkdown(r2);
    expect(md3).toBe(md2);
  });
});
