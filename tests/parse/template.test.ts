import { describe, it, expect } from 'vitest';
import { findTemplateFault } from '../../src/parse/template.js';
import type { Resume } from '../../src/model/schema.js';

const RESUME: Resume = {
  contact: { name: 'Jane Doe', email: 'jane@example.com' },
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
          end: '2024',
          location: undefined,
          bullets: [{ id: 'r1b1', text: 'Shipped the thing' }],
        },
      ],
    },
    { name: 'Skills', bullets: [{ id: 's1', text: 'TypeScript' }] },
  ],
};

const GOOD = `<!doctype html><html><body>
<h1><%= it.contact.name %></h1><p><%= it.contact.email %></p>
<% it.sections.forEach(function (s) { %>
  <h2><%= s.name %></h2>
  <% if (s.entries) { %>
    <% s.entries.forEach(function (e) { %>
      <h3><%= e.title %> — <%= e.org %></h3>
      <ul><% e.bullets.forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
    <% }) %>
  <% } else { %>
    <ul><% (s.bullets || []).forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
  <% } %>
<% }) %>
</body></html>`;

// A generated template is model-written code, so these are the failure modes the
// import pass has to catch before writing anything to disk.
describe('findTemplateFault', () => {
  it('accepts a template that compiles and renders everything', () => {
    expect(findTemplateFault(GOOD, RESUME)).toBeNull();
  });

  it('rejects a template that does not compile', () => {
    expect(findTemplateFault('<% for ( %>', RESUME)).toBeTruthy();
  });

  it('rejects a template that throws on a field it assumed was present', () => {
    const fault = findTemplateFault('<html><%= it.contact.links.github %></html>', RESUME);
    expect(fault).toBeTruthy();
  });

  it('rejects output that is not a whole HTML document', () => {
    expect(findTemplateFault('<h1><%= it.contact.name %></h1>', RESUME)).toMatch(/complete HTML document/);
  });

  it('rejects a template that silently drops resume content', () => {
    const fault = findTemplateFault(GOOD.replace(/<ul>.*?<\/ul>/gs, ''), RESUME);
    expect(fault).toMatch(/missing 2 item\(s\)/);
    expect(fault).toContain('bullet r1b1');
  });

  it('names only a bounded number of missing items, so the repair prompt stays usable', () => {
    const many: Resume = {
      ...RESUME,
      sections: [
        {
          name: 'Skills',
          bullets: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, text: `Skill number ${i}` })),
        },
      ],
    };
    const fault = findTemplateFault('<html><body></body></html>', many);
    // name + email + section heading + 40 bullets
    expect(fault).toMatch(/missing 43 item\(s\)/);
    expect(fault!.split('\n').length).toBeLessThanOrEqual(14);
  });
});
