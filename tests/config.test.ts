import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, formatPdfName, loadConfig, parsePages } from '../src/config.js';

let dir: string;
const ENV_KEYS = ['RESUME_OUT_DIR', 'RESUME_PDF_DIR', 'RESUME_PDF_NAME'];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-tools-config-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

async function configFile(name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents, 'utf8');
  return path;
}

describe('loadConfig', () => {
  it('falls back to the defaults when there is no config file', async () => {
    expect(await loadConfig({}, join(dir, 'missing.json'))).toEqual(DEFAULTS);
  });

  it('takes settings from the config file', async () => {
    const path = await configFile('basic.json', JSON.stringify({ pdfName: '{name}_{company}' }));
    const config = await loadConfig({}, path);
    expect(config.pdfName).toBe('{name}_{company}');
    expect(config.pdfDir).toBe(DEFAULTS.pdfDir);
  });

  it('lets the environment override the config file', async () => {
    const path = await configFile('env.json', JSON.stringify({ pdfDir: 'from-file' }));
    process.env.RESUME_PDF_DIR = 'from-env';
    expect((await loadConfig({}, path)).pdfDir).toBe('from-env');
  });

  it('lets a flag override the environment', async () => {
    process.env.RESUME_PDF_DIR = 'from-env';
    expect((await loadConfig({ pdfDir: 'from-flag' }, join(dir, 'missing.json'))).pdfDir).toBe(
      'from-flag',
    );
  });

  it('ignores flags the user did not pass', async () => {
    process.env.RESUME_PDF_NAME = 'from-env';
    const config = await loadConfig({ pdfName: undefined }, join(dir, 'missing.json'));
    expect(config.pdfName).toBe('from-env');
  });

  it('says which file is bad JSON', async () => {
    const path = await configFile('broken.json', '{ nope');
    await expect(loadConfig({}, path)).rejects.toThrow(/broken\.json is not valid JSON/);
  });

  it('rejects an unknown key rather than silently ignoring it', async () => {
    const path = await configFile('typo.json', JSON.stringify({ pdfdir: 'out' }));
    await expect(loadConfig({}, path)).rejects.toThrow(/known keys/);
  });
});

describe('formatPdfName', () => {
  const tokens = {
    base: 'senior-engineer-acme.resume',
    name: 'Jane Doe',
    company: 'Acme Corp.',
    title: 'Senior Engineer',
  };

  it('passes {base} through unchanged', () => {
    expect(formatPdfName('{base}', tokens)).toBe('senior-engineer-acme.resume');
  });

  it('names the default for the company, else the title, else the recruiter', () => {
    expect(formatPdfName(DEFAULTS.pdfName, tokens)).toBe('jane_doe_acme_corp');
    expect(formatPdfName(DEFAULTS.pdfName, { name: 'Jane Doe', title: 'Senior Engineer', recruiter: 'Jo Bloggs' })).toBe(
      'jane_doe_senior_engineer',
    );
    expect(formatPdfName(DEFAULTS.pdfName, { name: 'Jane Doe', recruiter: 'Jo Bloggs' })).toBe(
      'jane_doe_jo_bloggs',
    );
    expect(formatPdfName(DEFAULTS.pdfName, { base: 'base.resume', name: 'Jane Doe' })).toBe('jane_doe');
  });

  it('takes the first set token in a {a|b} group, {base} included', () => {
    expect(formatPdfName('{recruiter|company}', tokens)).toBe('acme_corp');
    expect(formatPdfName('{recruiter|base}', tokens)).toBe('senior-engineer-acme.resume');
  });

  it('names an unknown token inside a group', () => {
    expect(() => formatPdfName('{company|employer}', tokens)).toThrow(/\{employer\}/);
  });

  it('slugifies content tokens', () => {
    expect(formatPdfName('{name}_{company}', tokens)).toBe('jane_doe_acme_corp');
  });

  it('keeps literal text in the pattern', () => {
    expect(formatPdfName('{name}-resume-{title}', tokens)).toBe(
      'jane_doe-resume-senior_engineer',
    );
  });

  it('collapses the separator beside a token with nothing behind it', () => {
    expect(formatPdfName('{name}_{company}', { base: 'base.resume', name: 'Jane Doe' })).toBe(
      'jane_doe',
    );
    expect(formatPdfName('{name}_{company}_{title}', { name: 'Jane', title: 'Engineer' })).toBe(
      'jane_engineer',
    );
  });

  it('falls back to the base name when nothing survives', () => {
    expect(formatPdfName('{company}', { base: 'base.resume' })).toBe('base.resume');
  });

  it('keeps the result to one path segment', () => {
    expect(formatPdfName('{name}/{company}', tokens)).toBe('jane_doe_acme_corp');
    expect(formatPdfName('{base}', { base: '../escape' })).toBe('.._escape');
  });

  it('names an unknown token instead of writing it into the filename', () => {
    expect(() => formatPdfName('{name}_{employer}', tokens)).toThrow(/\{employer\}.*known tokens/s);
  });
});

describe('pages', () => {
  it('reads a page budget from the config file and the environment', async () => {
    const path = await configFile('pages.json', JSON.stringify({ pages: 1 }));
    expect((await loadConfig({}, path)).pages).toBe(1);
    process.env.RESUME_PAGES = '2';
    expect((await loadConfig({}, path)).pages).toBe(2);
    delete process.env.RESUME_PAGES;
  });

  it('rejects a budget that is not a whole number of pages', async () => {
    expect(parsePages('1')).toBe(1);
    expect(() => parsePages('1.5')).toThrow(/whole number/);
    expect(() => parsePages('0')).toThrow(/at least 1/);
    const path = await configFile('bad-pages.json', JSON.stringify({ pages: 0 }));
    await expect(loadConfig({}, path)).rejects.toThrow(/pages/);
  });
});
