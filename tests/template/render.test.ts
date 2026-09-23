import { describe, it, expect } from 'vitest';
import { checkTemplateCoverage, renderTemplate, templateData } from '../../src/template/render.js';
import type { Resume } from '../../src/model/schema.js';

const RESUME: Resume = {
  contact: {
    name: 'Jane Doe',
    headline: 'Full Stack Developer',
    email: 'jane@example.com',
    phone: '+1 (555) 010-1234',
    links: { github: 'https://github.com/example' },
  },
  meta: undefined,
  template: undefined,
  sections: [
    {
      name: 'Experience',
      entries: [
        {
          id: 'r1',
          title: 'Founding Engineer',
          org: 'Contoso, Inc.',
          start: 'Jan-2025',
          end: 'Present',
          location: undefined,
          bullets: [{ id: 'r1b1', text: 'Built the ingest path' }],
        },
      ],
    },
    { name: 'Skills', bullets: [{ id: 's1', text: 'TypeScript, Go' }] },
  ],
};

const FULL_TEMPLATE = `<!doctype html><html><body>
<h1><%= it.contact.name %></h1>
<p><%= it.fmt.join([it.contact.email, it.contact.phone]) %></p>
<% it.sections.forEach(function (s) { %>
  <h2><%= s.name %></h2>
  <% if (s.entries) { %>
    <% s.entries.forEach(function (e) { %>
      <h3><%= e.title %> — <%= e.org %></h3>
      <p><%= it.fmt.meta(e) %></p>
      <ul><% e.bullets.forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
    <% }) %>
  <% } else { %>
    <ul><% (s.bullets || []).forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
  <% } %>
<% }) %>
</body></html>`;

describe('templateData', () => {
  it('exposes the model and the helpers, and nothing else', () => {
    expect(Object.keys(templateData(RESUME)).sort()).toEqual(['contact', 'fmt', 'meta', 'sections']);
  });
});

describe('renderTemplate', () => {
  it('merges the model into the template', () => {
    const html = renderTemplate(FULL_TEMPLATE, RESUME);
    expect(html).toContain('<h1>Jane Doe</h1>');
    expect(html).toContain('<li>Built the ingest path</li>');
  });

  it('escapes resume text, so content cannot break the document', () => {
    const nasty: Resume = { ...RESUME, contact: { ...RESUME.contact, name: 'A & B <script>x</script>' } };
    const html = renderTemplate(FULL_TEMPLATE, nasty);
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).not.toContain('<script>x');
  });

  it('formats dates through the helpers rather than printing raw tokens', () => {
    expect(renderTemplate(FULL_TEMPLATE, RESUME)).toContain('Jan 2025 – Present');
  });

  it('omits the separator when an entry has no location', () => {
    expect(renderTemplate(FULL_TEMPLATE, RESUME)).not.toMatch(/Present\s*·/);
  });

  it('names the template in the error when it fails to compile', () => {
    expect(() => renderTemplate('<% oops( %>', RESUME, 'broken')).toThrow(/template "broken" failed/);
  });

  it('names the template in the error when it throws at runtime', () => {
    expect(() => renderTemplate('<%= it.nope.deep %>', RESUME, 'broken')).toThrow(/template "broken" failed/);
  });
});

describe('checkTemplateCoverage', () => {
  it('passes a template that renders everything', () => {
    expect(checkTemplateCoverage(RESUME, renderTemplate(FULL_TEMPLATE, RESUME))).toEqual([]);
  });

  it('catches a template that silently drops bullets', () => {
    const noBullets = FULL_TEMPLATE.replace(/<ul>.*?<\/ul>/gs, '');
    const missing = checkTemplateCoverage(RESUME, renderTemplate(noBullets, RESUME));
    expect(missing).toContain('bullet r1b1: Built the ingest path');
    expect(missing).toContain('bullet s1: TypeScript, Go');
  });

  it('catches a template that handles entries but forgets bullets-only sections', () => {
    const entriesOnly = `<!doctype html><html><body>
<h1><%= it.contact.name %></h1>
<p><%= it.fmt.join([it.contact.email, it.contact.phone]) %></p>
<% it.sections.forEach(function (s) { %>
  <h2><%= s.name %></h2>
  <% (s.entries || []).forEach(function (e) { %>
    <h3><%= e.title %> — <%= e.org %></h3>
    <ul><% e.bullets.forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
  <% }) %>
<% }) %>
</body></html>`;
    const missing = checkTemplateCoverage(RESUME, renderTemplate(entriesOnly, RESUME));
    expect(missing).toEqual(['bullet s1: TypeScript, Go']);
  });

  it('does not mistake text inside a style block for rendered content', () => {
    const hidden = '<!doctype html><html><head><style>/* Built the ingest path */</style></head><body></body></html>';
    expect(checkTemplateCoverage(RESUME, hidden)).toContain('bullet r1b1: Built the ingest path');
  });

  it('sees through HTML escaping, so ampersands do not read as dropped content', () => {
    const amp: Resume = {
      ...RESUME,
      sections: [{ name: 'Skills', bullets: [{ id: 's1', text: 'R&D and <ops>' }] }],
    };
    const html = renderTemplate(FULL_TEMPLATE, amp);
    expect(html).toContain('R&amp;D');
    expect(checkTemplateCoverage(amp, html)).toEqual([]);
  });
});
