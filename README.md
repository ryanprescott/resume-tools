# resume-tools

A CLI for keeping one canonical resume in structured Markdown, styling it with
swappable HTML/CSS templates, and exporting it to PDF and HTML — plus a
Claude-assisted path for tailoring it to a specific job description without
fabricating anything.

See [Project status](#project-status) for what exists today, and
[DESIGN.md](DESIGN.md) for the architecture.

---

## What it does today

```
resumes/base.resume.md    ← content: you edit this (canonical, git-tracked)
templates/*.html.eta      ← layout: swappable, referenced by name
        │
        ▼
      build ──▶ resumes/pdfs/base.resume.pdf   (the merged HTML, printed by Chrome)
                out/base.resume.html
                out/base.resume.md             (normalized round-trip)
```

The PDF is the file you actually send to someone, so it lands in its own
directory and can be named for the reader — `jane_doe_acme.pdf` — while the
HTML and normalized Markdown stay build artifacts in `out/`. See
[Configuration](#configuration).

A strict Markdown parser turns `*.resume.md` into a typed model. A template is a
self-contained HTML document with all its CSS inline and Eta (EJS-syntax) tags
where the content goes. `build` merges the two and prints the result with headless
Chrome, so a template can do anything CSS can — two-column headers, shaded bands,
coloured links, sidebars.

## Requirements

| | |
|---|---|
| Node.js | **≥ 24** (enforced via `engines`) |
| Chrome | bundled with `puppeteer` on `npm install` (~1.3 GB) — required only for PDF output |
| `pdftotext` | poppler-utils — required by `import` for the coverage cross-check, and by `tailor` when the job description is a PDF |

Set `PUPPETEER_EXECUTABLE_PATH` to reuse a system Chrome instead of the bundled
one. Verified working against Node 24.11.1 and Puppeteer 23.11.1.

## Install

```bash
npm install
```

## Usage

The CLI is run through `tsx` — there is no build-and-link step needed for daily use.

```bash
npm run cli -- build resumes/base.resume.md
```

```
wrote resumes/pdfs/base.resume.pdf
wrote out/base.resume.html
wrote out/base.resume.md
template: sharp
```

### `build <resumeFile>`

| Option | Default | Meaning |
|---|---|---|
| `--format <list>` | `pdf,html,md` | comma-separated subset of `pdf`, `html`, `md` |
| `--out <dir>` | `out` | directory for HTML and Markdown (created if missing) |
| `--pdf-out <dir>` | `resumes/pdfs` | directory for PDFs (created if missing) |
| `--pdf-name <pattern>` | `{name}_{company\|title\|recruiter}` | PDF filename pattern — see [Configuration](#configuration) |
| `--pages <n>` | none | fit onto at most this many pages — see [Fitting to a page count](#fitting-to-a-page-count) |
| `--no-fit` | off | keep a nearly empty last page rather than taking it back automatically |
| `--template <name>` | the resume's `template:` frontmatter | render with a different template, without editing the file |

```bash
# just a PDF
npm run cli -- build resumes/base.resume.md --format pdf

# a variant, named for the company, into its own directory
npm run cli -- build resumes/variants/acme.resume.md \
  --format pdf --pdf-name '{name}_{company}' --pdf-out ~/applications
```

HTML and Markdown are named after the input: `foo.resume.md` → `foo.resume.html`.
The PDF is named by `--pdf-name`, which defaults to your name plus the company,
role or recruiter. PDF and HTML come from the same merged document, so they
always match. That holds when fitting too: the HTML is the fitted document.

### Fitting to a page count

`--pages 1` squeezes the resume onto one page. This works with any template,
because it works on the rendered page, not the template's CSS. Each element's
computed sizes are scaled from their designed values in this order, and it
stops as soon as the resume fits:

1. vertical spacing (margins and padding between elements) and the `@page` margins
2. line height
3. font size — last, because it is the change a reader actually notices

A bisection finds the smallest adjustment that fits, so a resume one line over
loses a little whitespace, not a point of type size. Each setting has a floor
(spacing 40%, margins 60%, line height 87%, font size 85%). If the resume still
does not fit at those floors, it is printed as designed with a warning, because
the fix at that point is cutting content:

```
fitted 3 pages into 2 pages: spacing 53%, margins 69%
⚠ 3 pages does not fit in 1 page even at the tightest settings — printed as designed; cut some content to get there
```

A resume that already fits is left alone.

**Without `--pages`, a nearly empty last page is taken back automatically.**
Every build checks whether one page fewer fits using gentle settings only
(spacing ≥ 70%, margins ≥ 80%, line height ≥ 93%, font size never changed). A
spill of a few lines, such as the tail of an Education section, is absorbed
well within that. A last page with real content is not, so it stays as
designed. Nothing measures "empty": whether gentle tightening can absorb it
*is* the test. `--no-fit` turns this off.

```
pulled a nearly empty page 3 back: 2 pages with spacing 78%, margins 85% (--no-fit to keep it as designed)
```

Note that `--format md` is not a no-op copy — it re-serializes the parsed model,
which normalizes spacing and ID comments. It is a useful way to see the canonical
form of a file you hand-edited.

### `templates`

Lists every name `--template` accepts — everything in `templates/`.

```bash
npm run cli -- templates
```

### `import <pdf>`

| Option | Default | Meaning |
|---|---|---|
| `--out <file>` | `resumes/base.resume.md` | output resume markdown path |
| `--template-name <name>` | `imported-<yyyy-mm-dd>` | name for the template reconstructed from the PDF |

```bash
npm run cli -- import resumes/import.pdf --out resumes/base.resume.md
```

Requires an active `claude` CLI login (`claude login`); fails fast with an
actionable error if `~/.claude/.credentials.json` is missing.

Import runs **two independent passes** over the same PDF, concurrently:

1. **Content.** Claude reads the PDF (via the `Read` tool, low effort) and
   extracts the contact block — name, headline, email, phone, location, profile
   URLs — plus sections, entries, and bullets into the typed schema. No
   fabrication, pure transcription. IDs are then minted deterministically in code
   (`r1`, `r1b1`, `s1b1`, ...), never by the model.
2. **Layout.** A second pass asks Claude to reproduce the document's design as an
   HTML/CSS template, written to `templates/<template-name>.html.eta` and
   referenced from the new resume's frontmatter.

Splitting them is deliberate — asking one call for both reliably degrades the
transcription.

As a safety net against silent drops, the PDF is separately run through
`pdftotext -layout` and every substantive line is checked for word-level
coverage against the extracted model; anything under 60% overlap is printed as
a warning for manual review rather than silently accepted or rejected.

The layout pass emits code, so it is verified rather than trusted: the generated
template is compiled, rendered against your actual resume, and rejected if it
throws, if it does not produce a whole HTML document, or if any of your content
fails to reach the page. A fault is fed back for one repair attempt; a second
failure is an error rather than a broken file on disk.

It is still a reading of a picture, so treat the result as a first draft and edit
it — it is just CSS.

### `tailor <jdFile>`

An interactive run in six checkpoints. Writes a new variant under
`resumes/variants/` plus match / keyword / cover-letter reports; the variant
inherits the base's template. With `--build` (or `--pages <n>`, which implies
it) the variant is also printed to PDF and HTML as soon as it is written, so
tailoring and building are one step:

```bash
npm run cli -- tailor jds/acme.md --pages 1
```

The job description can be Markdown, plain text, or a PDF — the recruiter's
attachment works as well as a paste. The format is decided by the file's first
bytes, not its extension, so a PDF saved as `role.txt` is still read as a PDF
rather than as a screenful of mojibake. PDFs go through `pdftotext -layout`,
which keeps two-column pages readable; an image-only scan has no text to extract
and is reported as such instead of being sent to the model empty.

```
━━ 1/6 Job          the extracted spec — title, company, recruiter, occupation,
                    must-haves, keywords — editable before anything downstream
                    is built on it
━━ 2/6 Base         which base resume to start from, and whether this job is in
                    its occupation at all — see "Occupation bases" below
━━ 3/6 Gaps         requirements with no evidence in your resume. Pick the ones
                    you can actually speak to and answer in your own words
━━ 4/6 Cut          what the fabrication check killed, and why — keep any of it
                    by re-attributing the claim to yourself
━━ 5/6 Review       accept / edit / reject / add, one at a time, with the
                    rationale shown and `back` to change your mind
━━ 6/6 Additions    bullets, list lines or whole entries no suggestion proposed
```

Then it offers to promote what you added into `resumes/base.resume.md`. That is
the only thing that ever writes to the base, and it never happens without a
prompt.

| Option | Default | Meaning |
|---|---|---|
| `--from <resume>` | best match among all bases | tailor from exactly this base, skipping the match |
| `--company <name>` | the company the JD names | company name, used in the PDF name and the output slug |
| `--yes` | off | ask nothing; accept every verified suggestion |
| `--out <dir>` | `out` | where the reports go (see [Configuration](#configuration)) |
| `--variants <dir>` | `resumes/variants` | where the tailored variant goes |
| `--facts <file>` | `resumes/facts.md` | your accumulated facts (see below) |
| `--bases <dir>` | `resumes/bases` | occupation bases (see below) |
| `--build` | off | print the variant to PDF and HTML straight after writing it |
| `--pages <n>` | none | fit the PDF onto at most this many pages; implies `--build` |
| `--no-fit` | off | with `--build`: keep a nearly empty last page |
| `--pdf-out`, `--pdf-name`, `--template` | as for `build` | with `--build` |

Piping stdin, or any non-TTY, behaves as `--yes` rather than hanging on a
prompt nobody can answer.

Every Claude call runs behind a spinner with an elapsed counter, because the
stages are sequential and some take the better part of a minute:

```
⠹ working out what to change · combobulating · 24s · ^C to go back
✓ drafted edits · 41s
```

### Going back

**Ctrl-C means "go back", not "die"** — from any prompt, and from the middle of
a Claude call, which is aborted rather than left running. It opens a navigator:

```
── interrupted ───────────────────────────────────────────────────────

? Where to?
❯ resume 3/5 Cut
    ── go back to ──
  1/5 Job          Senior Full Stack Engineer · 17 must-have(s)
  2/5 Gaps         6 gap(s) · 2 answered
  ──────────────
  stop here and write what I have
  quit without writing anything
```

Two things make going back cheap enough to actually use:

- **Nothing is recomputed unless its inputs changed.** Return to the job stage,
  look at the spec, change nothing, and the coverage and suggestions you already
  have are reused. Change the title and both re-run.
- **Re-entering a stage keeps its work.** Every verdict you gave in the review
  comes back with you, including bullets you wrote yourself. The gap interview
  only asks about what is still unanswered, and lets you reword an answer.

Ctrl-C at the navigator itself means "never mind" and resumes. A second Ctrl-C
during the same wait exits outright, so a wedged request can't trap you.

### Occupation bases

Tailoring reweights what a base already says. That works for the next posting
in the same occupation, but not for a job outside it, where the right starting
point is a resume already framed for that occupation. So there is one base per
occupation: `resumes/base.resume.md`, plus any number under `resumes/bases/`.

At the **Base** stage every base is matched against the job. The match uses
each base's occupation, headline, summary, skills and roles, and the jobs
already tailored from it (read from the variants' `meta.basedOn`). You get the
closest base and a fit rating, and the model flags every entry in any base
that bears on the job:

| Fit | Meaning | Default |
|---|---|---|
| strong | same occupation | tailor from it as usual |
| partial | adjacent; reweighting covers most of it | tailor from it as usual |
| different occupation | experience needs reframing around what transfers | **pivot** |

Whichever base you pick, relevant entries from your *other* bases that it
lacks are offered first, pre-checked, to bring in as they stand — a help desk
job your IT Support base has should not have to be typed again when an
engineering posting wants it. Entries brought in count as evidence and are
offered for write-back into the chosen base at the end.

A **pivot** does three things differently:

1. **It asks about related work none of your resumes show.** The model lists
   up to 8 kinds of roles relevant to the job that no base shows (for an IT
   Support job: help desk, sysadmin, retail tech support). Pick the ones you
   have done and describe each as an entry, in your own words. These entries
   are added before anything is suggested, so they count as evidence and can
   be reframed like the rest.
2. **It tailors much more aggressively.** Every transferable bullet is
   rewritten around what the new occupation values, the summary is rewritten,
   and irrelevant bullets are dropped. The fabrication check is unchanged:
   transferable is not the same as equivalent, and a rewrite that claims a
   title, credential or duty the source does not state is cut.
3. **It saves the result as a new base,** `resumes/bases/<occupation>.resume.md`,
   with `meta.occupation` set and the headline you chose. The variant records
   that base as its `basedOn`, so the next posting in that occupation is
   matched to it and tailored as usual.

`npm run cli -- bases` lists every base and the jobs it has served. With
`--yes`, the recommendation is taken: a pivot runs without the roles interview
and keeps the base's headline, because nobody is there to vouch for a new one.

### Telling it things it doesn't know

The model can only reweight what your resume already says. Anything you type
during a run — a gap interview answer, a bullet you write yourself, a whole new
entry — becomes a **fact**: a first-class source that suggestions may cite, and
that is exempt from the fabrication check, because you are the authority on your
own history. The model still cannot invent anything.

Facts accumulate in `resumes/facts.md` so you type them once, not once per
application:

```markdown
- Ran the Kubernetes migration for 12 services at Acme, 2023  <!--id:u1-->  <!--used:acme-staff-->
- Hold AWS Solutions Architect Associate, 2024  <!--id:u2-->
```

A fact used as a bullet carries its ID (`u1`) into the variant, so the document
records where the claim came from. Promote it into the base resume at the end of
a run and it leaves `facts.md` — a fact lives in exactly one place.

---

## Configuration

Output directories and the PDF filename are decided once and then lived with, so
they can be set in a config file or the environment instead of retyped every
build. Highest precedence first: **CLI flag → environment → config file → default.**

`resume-tools.config.json`, in the directory you run from (`RESUME_TOOLS_CONFIG`
points elsewhere):

```json
{
  "outDir": "out",
  "pdfDir": "resumes/pdfs",
  "pdfName": "{name}_{company|title|recruiter}",
  "pages": 1
}
```

| Key | Env | Flag | Default | Meaning |
|---|---|---|---|---|
| `outDir` | `RESUME_OUT_DIR` | `--out` | `out` | HTML, Markdown, and `tailor` reports |
| `pdfDir` | `RESUME_PDF_DIR` | `--pdf-out` | `resumes/pdfs` | PDFs |
| `pdfName` | `RESUME_PDF_NAME` | `--pdf-name` | `{name}_{company\|title\|recruiter}` | PDF filename, without `.pdf` |
| `pages` | `RESUME_PAGES` | `--pages` | none | page budget for every PDF — see [Fitting to a page count](#fitting-to-a-page-count) |

An unknown key is an error rather than a silent no-op — a typo you notice at
build time beats one you notice on a wrongly named attachment.

### The PDF name pattern

| Token | From | Example |
|---|---|---|
| `{base}` | the input filename | `senior-engineer-acme.resume` |
| `{name}` | `name:` in the resume frontmatter | `jane_doe` |
| `{company}` | `meta.job.company` — variants only, when the posting names it | `acme_corp` |
| `{title}` | `meta.job.title` — variants only | `senior_engineer` |
| `{recruiter}` | `meta.job.recruiter` — variants only, when the posting names one | `dana_whitfield` |

`{a|b|c}` takes the first of those tokens that has a value. The default,
`{name}_{company|title|recruiter}`, names the file for the company when the
posting names one, else the job title, else the recruiter. `tailor` reads all
three from the job description, and you can correct them at the Job stage.

```
{name}_{company|title|recruiter} → jane_doe_acme_corp.pdf     (the default)
                                 → jane_doe_senior_engineer.pdf (no company named)
{base}                           → senior-engineer-acme.resume.pdf
{name}-resume-{company}          → jane_doe-resume-acme_corp.pdf
```

Two postings at the same company get the same default name, so the second
overwrites the first in `resumes/pdfs/`. Use `{name}_{company}_{title}` if you
apply to several roles at one company.

`{base}` passes through as it is, since it is already a filename. The others are
lowercased and run together with `_`, because they come from prose. A token with
nothing behind it — `{company}` on the untailored base resume — takes the
separator next to it with it, so you get `jane_doe.pdf`, not
`jane_doe_.pdf`. An unknown token is an error, not something that ends up
literally in the filename.

`resumes/` (including `resumes/pdfs/`) and `jds/` are git-ignored, since they
hold personal data. Remove them from `.gitignore` if you want them tracked.

---

## The canonical format

`resumes/*.resume.md` is YAML frontmatter plus a deliberately constrained
Markdown body. The parser is strict: it raises a line-numbered error rather than
guessing at anything it doesn't recognize.

```markdown
---
name: Jane D
headline: Senior Software Engineer
email: jane@example.com
phone: +1 (555) 010-1234
location: Remote
links:
  github: https://github.com/example
template: sharp
---

## Experience

### Senior Software Engineer — Contoso  <!--id:r1-->
2022-03 .. present · Remote

- Designed and shipped the core ledger reconciliation engine  <!--id:r1b1-->
- Cut month-end close from 5 days to under 6 hours  <!--id:r1b2-->

## Skills

- Languages: TypeScript, Python, Go  <!--id:s1b1-->
```

### Grammar

| Element | Form | Notes |
|---|---|---|
| Section | `## {name}` | |
| Entry | `### {title} — {org}  <!--id:...-->` | separator is an **em dash** surrounded by spaces; the id comment is **required** |
| Entry meta | `{start} .. {end}`, optionally ` · {location}` | must be the first non-blank line after the entry heading; separator is a **middle dot** |
| Bullet | `- {text}  <!--id:...-->` | id comment optional — see below |

Frontmatter fields: only `name` is required. `headline`, `email`, `phone`,
`location`, `links` (a label→**URL** map), `template`, and `meta` are optional.

An empty string counts as absent everywhere, so `location: ''` will not leave a
stranded `·` in the output. `phone` is its own field — a phone number parked
under `links` by an older import is lifted out automatically on the next parse.

### Two kinds of section

A section holds **either** entries **or** bare bullets, never both — the schema
enforces exactly one. `## Experience` is an entries-style section; `## Skills` is
a bullets-style section. Which one it is gets inferred from the first structural
line inside it, and mixing them is a parse error.

### IDs, and why they are HTML comments

Every entry and bullet carries a stable ID in a trailing HTML comment. The
comments are invisible in any rendered view of the Markdown and survive editing.
The alternative — identifying a bullet by its position — breaks the moment you
reorder anything, and tailoring is largely about reordering.

An entry heading **must** have an ID. A bullet without one gets an ID derived
from a SHA-1 content hash of its text (`h1a2b3c4d`), so a bullet you hand-add
still gets an identity that is stable across repeated parses. IDs are never
renumbered.

`src/model/ids.ts` also exports `mintEntryId` / `mintBulletId` /
`mintSkillBulletId` for sequential `r1` / `r1b1` / `s1b1` IDs. These are used by
the `import` command; the Markdown parser itself only uses the content-hash
path.

### Parse errors

Errors are line-numbered against the original file, frontmatter included:

```
line 15: expected entry heading "{title} — {org}"
line 16: expected entry meta line '{start} .. {end}' with optional ' · {location}'
line 12: entry heading missing id comment
line 11: bullet does not belong to any entry in this entries-style section
line 19: unrecognized syntax
```

That last one is the point of the strictness: a line the parser doesn't
understand is a hard failure, not a silently dropped resume bullet.

On the command line the error is shown with the offending line, and the
commonest mistake — pointing a resume command at a job description — is named
for what it is rather than reported as a syntax error on line 1:

```
✗ jds/acme.md does not look like a resume

  It has no YAML frontmatter with a `name:` and no `## Section` headings, so
  there is nothing here to parse as a resume.

  1 │ Our Product:

  did you mean
    npm run cli -- tailor jds/acme.md
```

---

## Templates

A resume names a template; it never embeds one. `templates/<name>.html.eta` is a
complete, self-contained HTML document with all its CSS in one inline `<style>`
block and Eta (EJS-syntax) tags where the content goes.

| Shipped | Look |
|---|---|
| `sharp` | two-column header (name left, headline right), shaded contact band, coloured links, Arial |
| `classic` | centred serif header, ruled section headings, Georgia |
| `minimal` | sparse and rule-free, generous whitespace, dash bullets |
| `default` | plain, no accent colour |

The ones that ship and the ones you write are the same kind of file in the same
directory — copy one and edit it.

### What a template receives

One object, `it`:

```
it.contact    { name, headline?, email?, phone?, location?, links? }
it.sections   Section[] — each has EXACTLY ONE of .entries or .bullets
it.meta       { basedOn?, job? }
it.fmt        dates(entry)  meta(entry)  channels(contact)
              join(parts, sep)  upper(s)  lower(s)
```

```html
<% it.sections.forEach(function (section) { %>
  <h2><%= section.name %></h2>
  <% if (section.entries) { %>
    <% section.entries.forEach(function (entry) { %>
      <h3><%= entry.title %></h3>
      <p class="meta"><%= entry.org %> — <%= it.fmt.meta(entry) %></p>
      <ul><% entry.bullets.forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
    <% }) %>
  <% } else { %>
    <ul><% (section.bullets || []).forEach(function (b) { %><li><%= b.text %></li><% }) %></ul>
  <% } %>
<% }) %>
```

`it.fmt` exists so date and contact formatting stay consistent rather than being
reinvented — differently — in every template.

`<%= %>` escapes; `<%~ %>` does not. Always use `<%= %>` for resume text, so a
bullet containing `<` or `&` cannot break the document.

### Templates are code, so their output is checked

A missing `else` branch silently drops your Skills section and still produces a
perfectly plausible resume. After every render, `build` compares the model
against the visible text of the output and warns with the exact IDs that went
missing:

```
⚠ template "custom" dropped 2 item(s) from the resume:
  - bullet s1: Languages: TypeScript, Go, Python
  - section: Skills
```

Keeping the template out of the resume is what makes re-theming cheap: every
tailored variant would otherwise carry a duplicate copy, and swapping design
would mean editing all of them.

---

## Architecture

```
src/
  cli.ts                commander entry; build/templates/import/tailor/bases commands
  build.ts              resume → PDF/HTML/MD files; shared by build and tailor --build
  claude.ts             Agent SDK wrapper (ask<T>()) + preflight auth check
  config.ts             output dirs and PDF name pattern; flag > env > file
  model/
    schema.ts           zod Resume schema + inferred TypeScript types
    ids.ts              ID minting and content-hash stability
  parse/
    markdown.ts         parseMarkdown / serializeMarkdown (deterministic, strict)
    jd.ts               readJd() — job description text, from Markdown or PDF
    pdf.ts              importPdf() + checkCoverage() pdftotext cross-check
    template.ts         PDF → Eta template via Claude, verified by rendering
  template/
    load.ts             name → template source; listing, writing
    render.ts           Eta merge + checkTemplateCoverage()
  render/
    format.ts           dates and contact channels — the `it.fmt` helpers
    pdf.ts              HTML → PDF via headless Chrome, and fitting to a page count
  tailor/
    run.ts              the six checkpoints, in order
    bases.ts route.ts   occupation bases; matching a job to one
    choose-base.ts      the Base stage: pick a base, pivot, related-roles interview
    analyze-jd.ts coverage.ts suggest.ts verify.ts apply.ts
    facts.ts            facts.md parse/serialize + FactStore
    confirm-jd.ts interview.ts rejections.ts review.ts additions.ts
    writeback.ts        promote variant additions into the base resume
  ui/
    chrome.ts           panels, rules, aligned fields, meters, diffs
    interrupt.ts        Interrupted (go back) vs Cancelled (stop)
    prompts.ts          themed @inquirer wrappers; Ctrl-C → Interrupted
    spinner.ts          withSpinner(), interruptible, aborts its work
    errors.ts           actionable parse-error rendering
  report/
    match.ts keywords.ts cover-letter.ts
tests/
  config.test.ts             precedence, and what the name pattern produces
  model/roundtrip.test.ts    parse/serialize fixed-point properties
  parse/markdown.test.ts     grammar violations, frontmatter, content-hash ids
  parse/jd.test.ts           PDF sniffing and pdftotext output cleanup
  parse/pdf.test.ts          checkCoverage() flagging behavior
  parse/template.test.ts     which generated templates get rejected, and why
  template/load.test.ts      resolution and error messages
  template/render.test.ts    merging, escaping, dropped-content detection
  template/builtin.test.ts   every shipped template, against a real resume
  tailor/facts.test.ts       facts.md round-trip, id minting, FactStore
  tailor/writeback.test.ts   what gets promoted into the base, and where
  tailor/apply.test.ts       every suggestion kind, plus structural additions
  ui/chrome.test.ts          layout maths against visible width, not bytes
  ui/errors.test.ts          "not a resume" vs "malformed resume"
  ui/spinner.test.ts         value/error pass-through, clean non-TTY output
  fixtures/sample.resume.md
templates/*.html.eta    shipped and hand-written alike
resumes/base.resume.md
resumes/facts.md        claims you supplied, not yet in the resume
resumes/pdfs/           printed PDFs — the files you send
out/                    build artifacts (git-ignored)
```

### The model

`src/model/schema.ts` defines the whole data model in zod. The design intent is
that this one schema drives three things: parser output validation (today),
`outputFormat` JSON Schema for Claude, and renderer input.

```ts
Resume  { contact, meta?, template?, sections: Section[] }
Contact { name, headline?, email?, phone?, location?, links? }
Section { name, entries?: Entry[] }    // XOR
        { name, bullets?: Bullet[] }   // enforced by superRefine
Entry   { id, title, org, start, end, location?, bullets: Bullet[] }
Bullet  { id, text }
Meta    { basedOn?, occupation?, job?: { title, company?, recruiter? } }   // bases / variants
```

`template` is a name, not an embedded blob — see [Templates](#templates-1).

Everything is a plain string, including dates — `start` and `end` hold whatever
the resume says (`2022-03`, `present`), because normalizing them would only
create a formatting decision the source file already made.

### Rendering

**HTML** (`template/render.ts`) merges the model into the chosen template with
Eta, running with `autoEscape` so all interpolated resume text is escaped by
default.

**PDF** (`render/pdf.ts`) prints that same HTML with headless Chrome. It uses
`printBackground` so shaded bands survive, and `preferCSSPageSize` so the
template's `@page` rule owns the page size and margins.

> **Gotcha, already handled:** Chrome applies print styles only under the `print`
> media type. `renderPdf` calls `emulateMediaType('print')` before printing —
> without it, `@page` is ignored entirely and you get default letter margins.

There is deliberately **no DOCX output.** It previously existed as an ATS-plain
second path, but maintaining a permanently-inferior renderer alongside the
template system was not worth it. If an ATS-friendly file becomes necessary, the
honest fix is a deliberately plain template, not a second rendering engine.

---

## Development

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # tsc -p .  → dist/
npm run cli -- …  # tsx src/cli.ts
```

Current state: 238 tests across 23 files, all passing; typecheck clean under
`strict`.

TypeScript is configured as ES2022 / NodeNext ESM. The package is `"type":
"module"`, so **relative imports must carry a `.js` extension** even though the
source files are `.ts` — this is what NodeNext requires, and existing code
follows it consistently.

### The test that matters most

`tests/model/roundtrip.test.ts` asserts the parser and serializer are inverses:

- `parse(serialize(parse(x)))` deep-equals `parse(x)` — a fixed point
- `serialize` is byte-identical on the second pass — idempotent

These are the invariants that make it safe for a future `tailor` command to
patch the model and write the file back out. If you touch the grammar, this test
is the one to keep green.

`tests/parse/markdown.test.ts` covers the failure modes deliberately: a missing
ID comment, a malformed meta line, and an orphan bullet appearing before the
first entry heading. Each must throw an error matching `/line \d+/`.

`tests/template/builtin.test.ts` runs every shipped template against a real
resume and against a deliberately sparse one (no headline, no contact details, no
location), asserting each produces a whole HTML document, drops nothing, sets a
page box, keeps its backgrounds when printed, avoids splitting entries across
pages, pulls in no external assets, and never uses Eta's unescaped `<%~` output.
Add a template and it is covered automatically.

---

## Design principles

Taken from [DESIGN.md](DESIGN.md); they explain most of the choices above.

1. **One canonical document.** The structured Markdown file is the source of
   truth. The JSON model, HTML, and PDF are all derived.
2. **Content and layout are separate files.** The resume says *what*; the
   template says *how it looks*. Swapping design is a one-word frontmatter change.
3. **No fabrication, structurally enforced.** Every proposed edit must cite the
   source it derives from, and a separate verification pass with fresh context
   rejects any suggestion asserting a claim with no antecedent. Rephrase,
   reorder, reweight — never invent.
4. **You are a source; the model is not.** Facts you type during a run are
   citable source material and skip the fact-check, because you are the
   authority on your own history. What principle 3 forbids is the *model*
   inventing.
5. **Ask rather than decide.** Where the tool has a guess and you have the truth,
   it stops and asks. A stage that silently decides on your behalf and reports it
   in a file you read afterwards is a bug.
6. **Claude only where it earns its place.** Parsing Markdown, assigning IDs, and
   merging a template are deterministic code. Claude reads the PDF, analyzes the
   job description, and proposes edits. Don't put a model in a loop a parser can
   do exactly.
7. **The base resume is never mutated** *without asking*. `tailor` always writes
   a new variant, then offers to promote what you added.

## Project status

| Milestone | Scope | State |
|---|---|---|
| **M1** | Schema, Markdown parser/serializer, template layer, PDF renderer, round-trip tests | **Done** — `build` works end to end |
| **M2** | `import`: PDF → model *and* PDF → template via Claude, with coverage cross-checks | **Done** — `import` works end to end |
| **M3** | `tailor`: JD analysis → coverage → suggestions → fabrication verify → apply, plus match / keyword / cover-letter reports | **Done** — `tailor` works end to end |
| **M4** | Interactive tailoring: five checkpoints, user-supplied facts with write-back, `@inquirer` console | **Done** |

Claude access goes through the Claude Agent SDK, which reuses the existing
logged-in `claude` CLI session. There is no API key anywhere in this codebase,
and none is needed.
