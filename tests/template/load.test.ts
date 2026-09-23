import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTemplates, loadTemplate, writeTemplate } from '../../src/template/load.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-tools-templates-'));
  await writeFile(join(dir, 'house.html.eta'), '<html>house</html>', 'utf8');
  await writeFile(join(dir, 'other.html.eta'), '<html>other</html>', 'utf8');
  await writeFile(join(dir, 'notes.txt'), 'not a template', 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadTemplate', () => {
  it('reads a template by name', async () => {
    const template = await loadTemplate('house', dir);
    expect(template.name).toBe('house');
    expect(template.source).toContain('house');
  });

  it('names the available templates when asked for one that does not exist', async () => {
    await expect(loadTemplate('nope', dir)).rejects.toThrow(/unknown template "nope".*house, other/s);
  });

  it('says so plainly when the directory holds no templates at all', async () => {
    await expect(loadTemplate('nope', join(dir, 'missing'))).rejects.toThrow(/\(none\)/);
  });
});

describe('listTemplates', () => {
  it('lists template files and ignores everything else', async () => {
    expect(await listTemplates(dir)).toEqual(['house', 'other']);
  });

  it('returns nothing rather than throwing when the directory is absent', async () => {
    expect(await listTemplates(join(dir, 'missing'))).toEqual([]);
  });
});

describe('writeTemplate', () => {
  it('round-trips through loadTemplate', async () => {
    await writeTemplate('generated', '<html>generated</html>', dir);
    expect((await loadTemplate('generated', dir)).source).toContain('generated');
  });

  it('ends the file with a newline', async () => {
    await writeTemplate('trailing', '<html>x</html>', dir);
    expect((await loadTemplate('trailing', dir)).source.endsWith('\n')).toBe(true);
  });
});
