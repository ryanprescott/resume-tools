import { z } from 'zod';
import { ask } from '../claude.js';
import type { Resume } from '../model/schema.js';
import { checkTemplateCoverage, renderTemplate } from '../template/render.js';

const GeneratedTemplateSchema = z.object({
  template: z.string(),
  /** What the model believes it reproduced — printed for the user to sanity-check. */
  notes: z.string(),
});

const DATA_CONTRACT = `The template is an Eta (EJS-syntax) HTML file. It receives one object, \`it\`:

  it.contact  { name, headline?, email?, phone?, location?, links? }
              links is a { label: url } map — labels like "github", "linkedin".
  it.sections Section[]. A section has a name and EXACTLY ONE of:
                .entries — Entry[]  (job history, education)
                .bullets — Bullet[] (skills, summary)
              Always branch on \`if (section.entries) { ... } else { ... }\`.
  it.meta     { basedOn?, job? } — optional, usually ignored by templates.
  it.fmt      helpers:
                fmt.channels(contact) -> { primary: string[], links: [{label,url}] }
                    primary is email/phone/location, already filtered for absence.
                fmt.meta(entry)   -> "Jan 2025 – Present · Remote" (location omitted if absent)
                fmt.dates(entry)  -> "Jan 2025 – Present"
                fmt.join(parts, sep) -> joins, skipping empty values
                fmt.upper(s), fmt.lower(s)

  Entry  { id, title, org, start, end, location?, bullets: Bullet[] }
  Bullet { id, text }

Syntax rules:
  <%= value %>   interpolates AND HTML-escapes. Use this for all resume text.
  <% code %>     runs JavaScript. Use .forEach(function (x) { ... }) for loops.
  Do NOT use <%~ %> (raw, unescaped) anywhere.
  Do NOT use \`await\`, imports, require, or fetch.`;

const OUTPUT_RULES = `Requirements for the template you produce:
- A complete, self-contained HTML document: <!doctype html> through </html>, with
  ALL CSS in a single inline <style> block. No external fonts, stylesheets or images.
- Set the print box with @page { size: ...; margin: ...; } and use pt units for type.
- Include -webkit-print-color-adjust: exact and print-color-adjust: exact on body,
  or Chrome will drop background colours when printing.
- Add break-inside: avoid and page-break-inside: avoid to each entry block so a job
  is never split across pages.
- Render EVERY section, entry and bullet the data contains. Never hard-code the
  resume's actual wording, job titles, or section names into the markup — read them
  all from \`it\`. The template must work for a different resume.
- Handle optional fields with \`if\`: headline, location and links may be absent.`;

export interface ReconstructedTemplate {
  source: string;
  notes: string;
  warnings: string[];
}

/** Compile and render the candidate, returning why it is unusable, or null. */
export function findTemplateFault(source: string, resume: Resume): string | null {
  let html: string;
  try {
    html = renderTemplate(source, resume, 'candidate');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    return 'output is not a complete HTML document (missing <html> ... </html>)';
  }

  const missing = checkTemplateCoverage(resume, html);
  if (missing.length > 0) {
    return `the rendered output is missing ${missing.length} item(s) from the resume:\n${missing
      .slice(0, 12)
      .map((m) => `  - ${m}`)
      .join('\n')}`;
  }

  return null;
}

/**
 * Reconstruct the source PDF's layout as an Eta template.
 *
 * The model writes code, so the result is verified rather than trusted: it is
 * compiled and rendered against the real resume, and checked for dropped
 * content. A fault is fed back for one repair attempt before giving up.
 */
export async function reconstructTemplate(
  absPdfPath: string,
  resume: Resume,
): Promise<ReconstructedTemplate> {
  const warnings: string[] = [];

  let result = await ask({
    prompt:
      `Read the resume PDF at ${absPdfPath} and reproduce its visual design as a reusable ` +
      'HTML/CSS template.\n\nLook at how the page is actually laid out: the arrangement of the ' +
      'name and any professional title, whether contact details sit in a band or column, the ' +
      'typeface and sizes, the colours, how section headings are set, whether a job entry puts ' +
      'its title above the employer or beside it, and how tightly everything is packed. ' +
      'Match it as closely as you can with CSS.\n\n' +
      `${DATA_CONTRACT}\n\n${OUTPUT_RULES}\n\n` +
      'Put the template source in "template" and a one-paragraph summary of the design ' +
      'decisions you matched in "notes".',
    schema: GeneratedTemplateSchema,
    tools: ['Read'],
    effort: 'high',
  });

  let fault = findTemplateFault(result.template, resume);
  if (fault) {
    warnings.push(`first attempt was rejected: ${fault.split('\n')[0]}`);
    result = await ask({
      prompt:
        'You wrote this Eta resume template, but it is broken:\n\n' +
        `--- template ---\n${result.template}\n--- end template ---\n\n` +
        `Problem:\n${fault}\n\n` +
        `${DATA_CONTRACT}\n\n${OUTPUT_RULES}\n\n` +
        'Return the corrected template in "template", preserving the visual design, and ' +
        'describe what you fixed in "notes".',
      schema: GeneratedTemplateSchema,
      effort: 'high',
    });

    fault = findTemplateFault(result.template, resume);
    if (fault) {
      throw new Error(
        `could not reconstruct a working template from the PDF. Last fault:\n${fault}\n` +
          'Import the content with --template default and adjust a built-in template by hand.',
      );
    }
  }

  return { source: result.template, notes: result.notes, warnings };
}
