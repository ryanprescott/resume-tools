import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseMarkdown } from '../../src/parse/markdown.js';
import { listTemplates, loadTemplate } from '../../src/template/load.js';
import { checkTemplateCoverage, renderTemplate } from '../../src/template/render.js';
import type { Resume } from '../../src/model/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const templatesDir = join(repoRoot, 'templates');

const resume = parseMarkdown(
  await readFile(join(repoRoot, 'tests', 'fixtures', 'sample.resume.md'), 'utf8'),
);

/** A resume exercising the optional-field branches every template must handle. */
const SPARSE: Resume = {
  contact: { name: 'No Frills' },
  meta: undefined,
  template: undefined,
  sections: [
    {
      name: 'Experience',
      entries: [
        {
          id: 'r1',
          title: 'Engineer',
          org: 'Acme',
          start: '2020',
          end: '2020',
          location: undefined,
          bullets: [{ id: 'r1b1', text: 'Did the work' }],
        },
      ],
    },
    { name: 'Skills', bullets: [{ id: 's1', text: 'Everything' }] },
  ],
};

const names = await listTemplates(templatesDir);

describe('built-in templates', () => {
  it('ships at least the four documented templates', () => {
    expect(names).toEqual(expect.arrayContaining(['classic', 'default', 'minimal', 'sharp']));
  });

  it.each(names)('%s renders a complete HTML document', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    const html = renderTemplate(source, resume, name);
    expect(html).toMatch(/^\s*<!doctype html>/i);
    expect(html).toContain('</html>');
  });

  it.each(names)('%s renders every part of the resume', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    expect(checkTemplateCoverage(resume, renderTemplate(source, resume, name))).toEqual([]);
  });

  it.each(names)('%s survives a resume with no headline, contact details or location', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    const html = renderTemplate(source, SPARSE, name);
    expect(checkTemplateCoverage(SPARSE, html)).toEqual([]);
    // A missing location must not leave the separator stranded on the meta line.
    expect(html).not.toMatch(/2020\s*·\s*</);
  });

  it.each(names)('%s sets a print page box', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    expect(source).toMatch(/@page\s*\{[^}]*margin/s);
  });

  it.each(names)('%s keeps backgrounds when Chrome prints it', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    expect(source).toContain('print-color-adjust: exact');
  });

  it.each(names)('%s avoids splitting an entry across pages', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    expect(source).toContain('break-inside: avoid');
  });

  it.each(names)('%s is self-contained — no external assets', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    expect(source).not.toMatch(/<link\b[^>]*rel=["']?stylesheet/i);
    expect(source).not.toMatch(/<script\b/i);
    expect(source).not.toMatch(/@import\b/);
    expect(source).not.toMatch(/url\(\s*["']?https?:/i);
  });

  it.each(names)('%s escapes all interpolated resume text', async (name) => {
    const { source } = await loadTemplate(name, templatesDir);
    // <%~ %> is Eta's raw, unescaped output — resume text must never use it.
    expect(source).not.toContain('<%~');
  });
});
