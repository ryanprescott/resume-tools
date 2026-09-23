import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { serializeMarkdown } from './parse/markdown.js';
import { describeFit, printPdf, type PrintResult } from './render/pdf.js';
import { checkTemplateCoverage, renderTemplate } from './template/render.js';
import { loadTemplate } from './template/load.js';
import { formatPdfName, type Config } from './config.js';
import { withSpinner } from './ui/spinner.js';
import type { Resume } from './model/schema.js';

/**
 * Turning a parsed resume into the files you send. Shared by `build` and by
 * `tailor --build`, so a variant printed at the end of a tailoring run comes
 * out exactly as `build` would have printed it.
 */

export const FORMATS = ['pdf', 'html', 'md'] as const;
export type Format = (typeof FORMATS)[number];

export interface BuildOptions extends Config {
  formats: readonly string[];
  /** Overrides the resume's `template:` frontmatter. */
  template?: string;
  /**
   * Without a `pages` budget, take back a nearly empty last page
   * automatically. On unless `--no-fit`.
   */
  autoFit?: boolean;
}

export interface BuildResult {
  written: string[];
  templateName?: string;
  /** Anything worth saying that is not a written path: dropped content, fitting. */
  notes: string[];
}

/** `foo.resume.md` → `foo.resume`, the stem every non-PDF output is named after. */
export function resumeBase(file: string): string {
  return basename(file, extname(file)).replace(/\.resume$/, '') + '.resume';
}

export async function buildResume(resume: Resume, base: string, opts: BuildOptions): Promise<BuildResult> {
  const formats = opts.formats.map((f) => f.trim().toLowerCase());
  for (const format of formats) {
    if (!(FORMATS as readonly string[]).includes(format)) throw new Error(`unknown format: ${format}`);
  }

  const notes: string[] = [];
  const written: string[] = [];
  let html: string | undefined;
  let templateName: string | undefined;

  if (formats.some((f) => f === 'pdf' || f === 'html')) {
    const template = await loadTemplate(opts.template ?? resume.template);
    templateName = template.name;
    html = renderTemplate(template.source, resume, template.name);

    const missing = checkTemplateCoverage(resume, html);
    if (missing.length > 0) {
      notes.push(`⚠ template "${template.name}" dropped ${missing.length} item(s) from the resume:`);
      for (const item of missing) notes.push(`  - ${item}`);
    }
  }

  // Printing comes first when there is a page budget: fitting changes the
  // document, and the HTML written below has to be the one that was printed.
  let printed: PrintResult | undefined;
  const autoFit = opts.autoFit ?? true;
  if (formats.includes('pdf') || (formats.includes('html') && (opts.pages !== undefined || autoFit))) {
    // Chrome launch plus print is a multi-second wait of its own.
    printed = await withSpinner(
      opts.pages === undefined ? 'printing with headless Chrome' : `printing and fitting to ${opts.pages} page(s)`,
      () => printPdf(html!, { pages: opts.pages, auto: autoFit }),
    );
    const fitNote = describeFit(printed, opts.pages);
    if (fitNote) notes.push(fitNote);
  }

  // The PDF is the file you send to someone, so it gets its own directory
  // and its own name; the rest stay build artifacts named after the input.
  const pdfBase = formatPdfName(opts.pdfName, {
    base,
    name: resume.contact.name,
    company: resume.meta?.job?.company,
    title: resume.meta?.job?.title,
    recruiter: resume.meta?.job?.recruiter,
  });

  // Only make a directory a requested format is actually going to use.
  if (formats.some((f) => f === 'md' || f === 'html')) await mkdir(opts.outDir, { recursive: true });
  if (formats.includes('pdf')) await mkdir(opts.pdfDir, { recursive: true });

  for (const format of formats) {
    const outPath = format === 'pdf' ? join(opts.pdfDir, `${pdfBase}.pdf`) : join(opts.outDir, `${base}.${format}`);
    if (format === 'md') await writeFile(outPath, serializeMarkdown(resume), 'utf8');
    else if (format === 'html') await writeFile(outPath, printed?.html ?? html!, 'utf8');
    else await writeFile(outPath, printed!.pdf);
    written.push(outPath);
  }

  return { written, templateName, notes };
}
