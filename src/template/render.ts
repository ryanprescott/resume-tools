import { Eta } from 'eta';
import type { Resume } from '../model/schema.js';
import { templateHelpers, type TemplateHelpers } from '../render/format.js';

/** What a template sees. `it.fmt` holds the shared formatting helpers. */
export interface TemplateData {
  contact: Resume['contact'];
  meta: Resume['meta'];
  sections: Resume['sections'];
  fmt: TemplateHelpers;
}

// autoEscape means `<%= %>` escapes and `<%~ %>` is the explicit raw opt-out, so
// resume text containing < or & cannot break the document by accident.
const eta = new Eta({ autoEscape: true, useWith: false, rmWhitespace: false });

export function templateData(resume: Resume): TemplateData {
  return {
    contact: resume.contact,
    meta: resume.meta,
    sections: resume.sections,
    fmt: templateHelpers,
  };
}

export function renderTemplate(source: string, resume: Resume, templateName = 'template'): string {
  try {
    return eta.renderString(source, templateData(resume));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`template "${templateName}" failed to render: ${message}`);
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** Rendered HTML reduced to its visible text, for comparison against the model. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A template is code, and code can silently omit a section. Compare what the
 * model holds against what actually reached the page, so a template that drops
 * your last job fails loudly instead of producing a plausible shorter resume.
 */
export function checkTemplateCoverage(resume: Resume, html: string): string[] {
  const text = visibleText(html);
  const missing: string[] = [];

  const check = (value: string | undefined, label: string): void => {
    if (!value) return;
    const needle = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (needle && !text.includes(needle)) missing.push(`${label}: ${value}`);
  };

  check(resume.contact.name, 'name');
  check(resume.contact.email, 'email');
  check(resume.contact.phone, 'phone');

  for (const section of resume.sections) {
    check(section.name, 'section');
    for (const entry of section.entries ?? []) {
      check(entry.title, `entry ${entry.id} title`);
      check(entry.org, `entry ${entry.id} org`);
      for (const bullet of entry.bullets) check(bullet.text, `bullet ${bullet.id}`);
    }
    for (const bullet of section.bullets ?? []) check(bullet.text, `bullet ${bullet.id}`);
  }

  return missing;
}
