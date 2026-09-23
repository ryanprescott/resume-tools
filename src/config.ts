import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Where output lands and what the PDF is called.
 *
 * These are settings you decide once and then live with — the PDF is the file
 * you actually attach to an application, so it wants a name a recruiter can
 * read and a directory you can point a file picker at, while the HTML and the
 * normalized Markdown stay build artifacts. So they are settable in a config
 * file or the environment, and still overridable by a flag for the one-off run.
 *
 * Precedence, highest first: CLI flag, environment, config file, default.
 */

/** Config file location; `RESUME_TOOLS_CONFIG` moves it. */
export const CONFIG_PATH = process.env.RESUME_TOOLS_CONFIG || 'resume-tools.config.json';

// Strict: a misspelled key in a config file you wrote weeks ago is silently
// ignored otherwise, and you find out by looking at a wrongly named PDF.
const ConfigFileSchema = z
  .object({
    outDir: z.string().trim().min(1).optional(),
    pdfDir: z.string().trim().min(1).optional(),
    pdfName: z.string().trim().min(1).optional(),
    pages: z.number().int().positive().optional(),
  })
  .strict();

export interface Config {
  /** Directory for HTML and Markdown output, and for `tailor` reports. */
  outDir: string;
  /** Directory for PDF output. */
  pdfDir: string;
  /** Filename pattern for PDFs, without the extension. See `formatPdfName`. */
  pdfName: string;
  /** Squeeze the PDF onto at most this many pages. Absent: print as the template lays it out. */
  pages?: number;
}

export const DEFAULTS: Config = {
  outDir: 'out',
  pdfDir: 'resumes/pdfs',
  // Named for the reader: the company when the posting names one, else the
  // role, else the recruiter who sent it — whichever is actually known.
  pdfName: '{name}_{company|title|recruiter}',
};

/** The tokens `pdfName` understands. */
export const PDF_NAME_TOKENS = ['base', 'name', 'company', 'title', 'recruiter'] as const;
export type PdfNameToken = (typeof PDF_NAME_TOKENS)[number];

const TOKEN_LIST = PDF_NAME_TOKENS.map((t) => `{${t}}`).join(', ');

async function readConfigFile(path: string): Promise<Partial<Config>> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (err) {
    // No config file is the normal case, not a problem to report.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${path} is not a valid config:\n${issues}\n\nknown keys: outDir, pdfDir, pdfName, pages`);
  }
  return result.data;
}

function fromEnv(): Partial<Config> {
  const env: Partial<Config> = {};
  if (process.env.RESUME_OUT_DIR) env.outDir = process.env.RESUME_OUT_DIR;
  if (process.env.RESUME_PDF_DIR) env.pdfDir = process.env.RESUME_PDF_DIR;
  if (process.env.RESUME_PDF_NAME) env.pdfName = process.env.RESUME_PDF_NAME;
  if (process.env.RESUME_PAGES) env.pages = parsePages(process.env.RESUME_PAGES, 'RESUME_PAGES');
  return env;
}

/** A page budget from a flag or the environment: a whole number, at least 1. */
export function parsePages(value: string, source = '--pages'): number {
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`${source} must be a whole number of pages, at least 1 (got "${value}")`);
  }
  return pages;
}

/** Drop keys that are absent, so a layer below can still supply them. */
function defined<T extends object>(layer: T): Partial<T> {
  return Object.fromEntries(Object.entries(layer).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Resolve the settings for a run. `flags` are the CLI options as commander saw
 * them — an option the user did not pass must arrive here as `undefined`, which
 * is why the `build` and `tailor` options carry no commander-level defaults.
 */
export async function loadConfig(
  flags: Partial<Config> = {},
  path: string = CONFIG_PATH,
): Promise<Config> {
  const file = await readConfigFile(path);
  return { ...DEFAULTS, ...defined(file), ...defined(fromEnv()), ...defined(flags) };
}

/** Token values become one lowercase run-together word: "Jane Doe" → `jane_doe`. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Fill a PDF name pattern.
 *
 * `{base}` is the name derived from the input file and passes through as-is —
 * it is already a filename. The other tokens come from the resume's content and
 * are slugified, since `{name}_{company}` should give `jane_doe_acme.pdf`
 * rather than `Jane Doe_Acme.pdf`.
 *
 * `{a|b|c}` takes the first of those tokens that has a value. A posting does
 * not always name the company, or the recruiter, so `{company|title|recruiter}`
 * names the file for whichever one it does.
 *
 * A token with nothing behind it — `{company}` on a resume that was never
 * tailored — collapses along with the separator next to it, so the result never
 * has a dangling `_`. If nothing at all survives, the name falls back to
 * `{base}` rather than producing `.pdf`.
 */
export function formatPdfName(
  pattern: string,
  tokens: Partial<Record<PdfNameToken, string>>,
): string {
  const unknown = [...pattern.matchAll(/\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split('|'))
    .filter((t) => !(PDF_NAME_TOKENS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new Error(
      `unknown token(s) in the PDF name pattern "${pattern}": ` +
        `${unknown.map((t) => `{${t}}`).join(', ')}\n  known tokens: ${TOKEN_LIST}`,
    );
  }

  const base = (tokens.base ?? '').replace(/[/\\]/g, '_');
  const value = (token: PdfNameToken): string => (token === 'base' ? base : slug(tokens[token] ?? ''));
  const filled = pattern.replace(/\{([\w|]+)\}/g, (_, group: string) => {
    for (const token of group.split('|') as PdfNameToken[]) {
      const v = value(token);
      if (v !== '') return v;
    }
    return '';
  });

  const cleaned = filled
    // A separator on each side of an empty token would otherwise double up.
    .replace(/[_-]{2,}/g, (run) => run[0])
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '')
    // Whatever the pattern held, the result has to stay one path segment.
    .replace(/[/\\]/g, '_');

  return cleaned === '' ? base : cleaned;
}
