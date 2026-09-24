#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parseMarkdown, serializeMarkdown } from './parse/markdown.js';
import { listTemplates, writeTemplate, TEMPLATES_DIR } from './template/load.js';
import { checkAuth } from './claude.js';
import { DEFAULTS, PDF_NAME_TOKENS, loadConfig, parsePages } from './config.js';
import { buildResume, resumeBase } from './build.js';
import { BASES_DIR, loadBases } from './tailor/bases.js';
import { importPdf } from './parse/pdf.js';
import { runTailor } from './tailor/run.js';
import { FACTS_PATH } from './tailor/facts.js';
import { Cancelled, Interrupted } from './ui/interrupt.js';
import { renderParseError } from './ui/errors.js';
import { withSpinner } from './ui/spinner.js';
import { lintResume } from './lint/bullets.js';
import { lintSummary, renderLint } from './ui/lint.js';
import type { Resume } from './model/schema.js';

/** The base resume everything starts from, and the one `import` writes. */
const ROOT_BASE = 'resumes/base.resume.md';

const program = new Command();
program.name('resume-tools').description('Tailor a resume to a job description');

/**
 * Read and parse a resume, turning a parse failure into something you can act
 * on. Pointing a resume command at a job description is the easy mistake to
 * make, and it is the one the bare parser error explained worst.
 */
async function readResume(file: string, suggestion?: string): Promise<Resume> {
  const source = await readFile(file, 'utf8');
  try {
    return parseMarkdown(source);
  } catch (err) {
    const rendered = renderParseError(err, { file, source, suggestion });
    if (rendered === null) throw err;
    console.error(rendered);
    process.exit(1);
  }
}

program
  .command('build')
  .argument('<resumeFile>', 'path to a *.resume.md file')
  .option('--format <list>', 'comma-separated formats: pdf,html,md', 'pdf,html,md')
  .option('--out <dir>', `output directory for html/md (default: ${DEFAULTS.outDir})`)
  .option('--pdf-out <dir>', `output directory for pdf (default: ${DEFAULTS.pdfDir})`)
  .option('--pdf-name <pattern>', `pdf filename pattern; tokens ${PDF_NAME_TOKENS.map((t) => `{${t}}`).join(', ')}, or {a|b} for the first that is set (default: ${DEFAULTS.pdfName})`)
  .option('--pages <n>', 'fit onto at most this many pages by tightening spacing, margins, line height, then font size')
  .option('--no-fit', 'keep a nearly empty last page instead of tightening the layout to take it back')
  .option('--template <name>', 'template to render with, overriding the resume frontmatter')
  .action(
    async (
      resumeFile: string,
      opts: {
        format: string;
        out?: string;
        pdfOut?: string;
        pdfName?: string;
        pages?: string;
        fit: boolean;
        template?: string;
      },
    ) => {
      const config = await loadConfig({
        outDir: opts.out,
        pdfDir: opts.pdfOut,
        pdfName: opts.pdfName,
        pages: opts.pages === undefined ? undefined : parsePages(opts.pages),
      });
      const resume = await readResume(resumeFile, `npm run cli -- tailor ${resumeFile}`);

      const { written, templateName, notes } = await buildResume(resume, resumeBase(resumeFile), {
        ...config,
        formats: opts.format.split(','),
        template: opts.template,
        autoFit: opts.fit,
      });
      for (const line of notes) (line.startsWith('⚠') ? console.warn : console.log)(line);
      for (const path of written) console.log(`wrote ${path}`);
      if (templateName) console.log(`template: ${templateName}`);

      const findings = lintResume(resume);
      if (findings.length > 0) console.log(`${lintSummary(findings)} — npm run cli -- lint ${resumeFile}`);
    },
  );

program
  .command('lint')
  .description('check a resume for weak openers, mixed tense, filler, overlong bullets and missing results')
  .argument('<resumeFile>', 'path to a *.resume.md file')
  .option('--all', 'list every bullet that states no result, rather than a count', false)
  .action(async (resumeFile: string, opts: { all: boolean }) => {
    const resume = await readResume(resumeFile, `npm run cli -- tailor ${resumeFile}`);
    console.log(renderLint(resume, lintResume(resume), { all: opts.all }));
  });

program
  .command('templates')
  .description('list the templates available to --template')
  .action(async () => {
    const names = await listTemplates();
    if (names.length === 0) {
      console.log(`no templates found in ${TEMPLATES_DIR}/`);
      return;
    }
    for (const name of names) console.log(`  ${name}`);
  });

program
  .command('import')
  .argument('<pdf>', 'path to a resume PDF')
  .option('--out <file>', 'output resume markdown path', ROOT_BASE)
  .option('--template-name <name>', 'name for the template reconstructed from the PDF')
  .action(async (pdf: string, opts: { out: string; templateName?: string }) => {
    await checkAuth();
    const templateName = opts.templateName ?? `imported-${new Date().toISOString().slice(0, 10)}`;
    const { resume, template, discrepancies } = await withSpinner(
      `reading ${basename(pdf)} — content, then layout`,
      () => importPdf(pdf, templateName),
      { done: 'read the PDF' },
    );

    if (discrepancies.length) {
      console.warn(`⚠ ${discrepancies.length} line(s) from the PDF may be missing from the extracted resume:`);
      for (const d of discrepancies) console.warn(`  - ${d}`);
    }
    for (const warning of template.warnings) console.warn(`⚠ ${warning}`);

    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, serializeMarkdown(resume), 'utf8');
    console.log(`wrote ${opts.out}`);

    const templatePath = await writeTemplate(templateName, template.source);
    console.log(`wrote ${templatePath}`);
    console.log(`  ${template.notes}`);
  });

program
  .command('tailor')
  .argument('<jdFile>', 'path to a job description file (Markdown/text or PDF)')
  .option('--from <resume>', `tailor from exactly this base, rather than the best match among ${ROOT_BASE} and ${BASES_DIR}/`)
  .option('--company <name>', 'company name (defaults to the one the job description names)')
  .option('--yes', 'run without stopping to ask; accept every verified suggestion', false)
  .option('--out <dir>', `report output directory (default: ${DEFAULTS.outDir})`)
  .option('--variants <dir>', 'directory for tailored variants', 'resumes/variants')
  .option('--bases <dir>', 'directory of occupation bases', BASES_DIR)
  .option('--facts <file>', 'file of facts you have supplied in past runs', FACTS_PATH)
  .option('--build', 'print the tailored variant to PDF and HTML as soon as it is written', false)
  .option('--pages <n>', 'with --build: fit onto at most this many pages (implies --build)')
  .option('--no-fit', 'with --build: keep a nearly empty last page instead of taking it back')
  .option('--pdf-out <dir>', `with --build: output directory for the pdf (default: ${DEFAULTS.pdfDir})`)
  .option('--pdf-name <pattern>', `with --build: pdf filename pattern (default: ${DEFAULTS.pdfName})`)
  .option('--template <name>', 'with --build: template to render with, overriding the base')
  .action(
    async (
      jdFile: string,
      opts: {
        from?: string;
        company?: string;
        yes: boolean;
        out?: string;
        variants: string;
        bases: string;
        facts: string;
        build: boolean;
        pages?: string;
        fit: boolean;
        pdfOut?: string;
        pdfName?: string;
        template?: string;
      },
    ) => {
      const config = await loadConfig({
        outDir: opts.out,
        pdfDir: opts.pdfOut,
        pdfName: opts.pdfName,
        pages: opts.pages === undefined ? undefined : parsePages(opts.pages),
      });
      await checkAuth();
      const from = opts.from ?? ROOT_BASE;
      const resume = await readResume(
        from,
        `npm run cli -- tailor ${jdFile} --from <your-resume>.resume.md`,
      );

      await runTailor({
        jdFile,
        root: { path: from, resume },
        pinned: opts.from !== undefined,
        basesDir: opts.bases,
        company: opts.company,
        yes: opts.yes,
        outDir: config.outDir,
        variantDir: opts.variants,
        factsPath: opts.facts,
        build:
          opts.build || opts.pages !== undefined
            ? { ...config, formats: ['pdf', 'html'], template: opts.template, autoFit: opts.fit }
            : undefined,
      });
    },
  );

program
  .command('bases')
  .description('list the base resumes tailor chooses between, and what each has been used for')
  .option('--bases <dir>', 'directory of occupation bases', BASES_DIR)
  .option('--variants <dir>', 'directory for tailored variants', 'resumes/variants')
  .action(async (opts: { bases: string; variants: string }) => {
    const resume = await readResume(ROOT_BASE);
    const bases = await loadBases({ path: ROOT_BASE, resume }, opts.bases, opts.variants);
    for (const base of bases) {
      console.log(`  ${base.occupation}  ${base.path}`);
      console.log(`    ${base.usedFor.length} job(s)${base.usedFor.length ? `, e.g. ${base.usedFor.at(-1)}` : ''}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  // Stopping is a choice, not a crash. Files already reported as written above
  // stay; nothing further is. `Interrupted` only reaches here from commands
  // with no navigator to catch it, such as `build` and `import`.
  if (err instanceof Cancelled || err instanceof Interrupted) {
    console.error('\ncancelled');
    process.exit(130);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
