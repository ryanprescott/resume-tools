import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';

const execFileAsync = promisify(execFile);

/**
 * Job descriptions arrive as whatever the company handed out — a page pasted
 * into Markdown, the PDF the recruiter attached, or a Word document.
 * Everything downstream wants plain text, so the format question is answered
 * once, here.
 *
 * The format is decided by the file's first bytes rather than its extension:
 * a PDF saved as `role.txt` read as UTF-8 is a screenful of mojibake, and the
 * model will gamely extract a job spec from it.
 */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

// A .docx is a zip archive, so it opens with the zip local-file header. Other
// zips (.pptx, an actual .zip) match too; mammoth rejects those with its own
// error rather than us pretending to tell them apart here.
export function looksLikeDocx(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('latin1') === 'PK\x03\x04';
}

// The legacy binary .doc format (OLE compound file). We can't read it, but we
// can name it instead of dumping mojibake into the prompt.
export function looksLikeLegacyDoc(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('latin1') === '\xd0\xcf\x11\xe0';
}

/**
 * `pdftotext -layout` keeps a two-column page readable, at the cost of trailing
 * padding on every line, page-break form feeds, and long blank runs where the
 * header and footer margins were. None of that survives to the prompt.
 */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pdfToText(path: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('pdftotext', ['-layout', resolve(path), '-'], {
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `reading ${path} needs pdftotext, which is not installed — ` +
          'install poppler-utils (apt install poppler-utils, brew install poppler), ' +
          'or paste the job description into a .md file instead',
      );
    }
    throw new Error(
      `pdftotext could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = normalizePdfText(stdout);
  if (text === '') {
    // A scan or an image-only export: there are no glyphs to extract, and no
    // amount of retrying changes that.
    throw new Error(
      `${path} has no extractable text — it looks like a scanned or image-only PDF. ` +
        'Copy the job description into a .md file and point at that instead.',
    );
  }
  return text;
}

async function docxToText(path: string, bytes: Buffer): Promise<string> {
  let raw: string;
  try {
    ({ value: raw } = await mammoth.extractRawText({ buffer: bytes }));
  } catch (err) {
    throw new Error(
      `${path} looks like a zip container but could not be read as a .docx: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Raw extraction separates paragraphs with blank lines; the same trailing
  // whitespace / blank-run cleanup the PDF path needs applies here.
  const text = normalizePdfText(raw);
  if (text === '') {
    throw new Error(
      `${path} has no extractable text — the document body is empty or image-only. ` +
        'Copy the job description into a .md file and point at that instead.',
    );
  }
  return text;
}

/** The job description as plain text, whatever container it came in. */
export async function readJd(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (looksLikePdf(bytes)) return pdfToText(path);
  if (looksLikeDocx(bytes)) return docxToText(path, bytes);
  if (looksLikeLegacyDoc(bytes)) {
    throw new Error(
      `${path} is a legacy binary .doc file, which is not supported — ` +
        're-save it as .docx or PDF, or paste the job description into a .md file.',
    );
  }
  return bytes.toString('utf8');
}
