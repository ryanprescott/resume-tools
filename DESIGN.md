# resume-tools — design

CLI for tailoring a resume to job descriptions. Node 24 + TypeScript. Claude access
goes through the Claude Agent SDK, which uses the existing logged-in `claude` CLI
session — no API key anywhere in this codebase.

## Principles

1. **One canonical document.** A structured Markdown file is the source of truth.
   Everything else (JSON model, HTML, PDF) is derived.
2. **Content and layout are separate files.** The resume says *what*; an HTML/CSS
   template says *how it looks*. A variant inherits its base's template, and
   swapping design is a one-word frontmatter change — not an edit to every resume
   you own.
3. **No fabrication, structurally enforced.** Every proposed edit must cite the
   source it derives from, and a separate verification pass rejects any
   suggestion asserting a claim with no antecedent. Rephrase, reorder, reweight —
   never invent.
4. **You are a source; the model is not.** There are two kinds of source
   material: the base resume, and facts *you type* during a run. Both are
   citable, and a claim you make is exempt from fact-checking because you are the
   authority on your own history. What principle 3 forbids is the *model*
   inventing, and that is unchanged.
5. **Ask rather than decide.** Where the tool has a guess and you have the truth
   — is this what the job actually asks for, is this gap real, is this rejection
   fair — it stops and asks. A stage that silently decides on your behalf and
   reports it in a file you read afterwards is a bug.
6. **Claude only where it earns its place.** Parsing Markdown, assigning IDs, and
   merging a template are deterministic code. Claude reads the PDF, analyzes the JD,
   and proposes edits. Don't put a model in a loop that a parser can do exactly.
7. **The base resume is never mutated** *without asking*. `tailor` always writes
   a new variant; it offers, at the end, to promote what you added into the base.

## Data flow

```
                    ┌───────────────────────────────┐
 resume.pdf ──▶ import ──▶  resumes/base.resume.md  │  ← you edit this
                    │       (canonical, git-tracked)│
                    │  └▶ templates/imported-*.eta │  ← reconstructed layout
                    └──────────────┬────────────────┘
                                   │
                          ┌────────┴────────┐
 job-description.txt ──▶ tailor             │  confirm JD → coverage → gap interview
                          ▲                 │  → suggestions → fabrication check
   resumes/facts.md ──────┤                 │  → review → additions
   (what you told it) ◀───┤                 │
                          ▼                 │
        resumes/variants/acme-staff.resume.md
        out/acme-staff.match.md             │  ← match report
        out/acme-staff.keywords.md          │  ← ATS keyword coverage
        out/acme-staff.cover-letter.md      │
                          │                 │
                          ▼                 ▼
                        build ──▶ .html ──▶ .pdf   (+ .md)
```

`resumes/facts.md` is read at the start of a run and written at the end: it is a
staging area for claims about you that are not in the resume yet. A fact
promoted into the base resume leaves the file, so a given fact lives in exactly
one place and its ID never denotes two different things.

## Canonical format

`resumes/*.resume.md` — YAML frontmatter plus a constrained Markdown body.

```markdown
---
name: Jane D
headline: Staff Engineer                # the title printed beside/below the name
email: jane@example.com
phone: +1 (555) 010-1234                # its own field — never a "link"
location: Remote
links:
  github: https://github.com/...        # URLs only
template: sharp                         # templates/sharp.html.eta
meta:
  basedOn: base.resume.md@a1b2c3d      # variants only
  job:                                  # variants only
    company: Acme
    title: Staff Engineer
---

## Experience

### Staff Engineer — Acme  <!--id:r1-->
2023-01 .. present · Remote

- Cut p99 latency 40% by rewriting the ingest path  <!--id:r1b1-->
- Led migration of 30 services off the legacy queue  <!--id:r1b2-->

## Skills

- Languages: TypeScript, Go, Python  <!--id:s1-->
```

**Grammar (strict — the parser errors with line numbers rather than guessing):**

| Element | Form |
|---|---|
| Section | `## {name}` |
| Entry | `### {title} — {org}` + `<!--id:...-->` |
| Entry meta | line 2 of entry: `{start} .. {end}`, optionally ` · {location}` |
| Bullet | `- {text}` + `<!--id:...-->` |

Location is optional throughout: an empty string is normalized to absent, so a
remote-only resume never renders a stranded `·`.

**IDs.** Minted on import (`r1`, `r1b1`). On re-parse, read from the trailing HTML
comment; a bullet you hand-added without one gets an ID derived from a content hash,
so it is stable across subsequent parses. IDs are **never renumbered** — variant
patches and match reports reference them.

The comments are invisible in rendered Markdown and survive editing. The alternative
— identifying bullets by position — breaks the moment you reorder anything.

## Typed model

`src/model/schema.ts`, zod. Drives three things at once: parser output validation,
`outputFormat` JSON Schema for Claude (via `zod-to-json-schema`), and renderer input.

```ts
Resume  { contact, meta, template?, sections: Section[] }
Contact { name, headline?, email?, phone?, location?, links? }
Section { name, entries: Entry[] }        // or bullets, for Skills-style sections
Entry   { id, title, org, start, end, location?, bullets: Bullet[] }
Bullet  { id, text }
```

`template` is a *name*, not an embedded blob — see below.

## Template layer

A template is an **Eta** (EJS-syntax) HTML file in `templates/<name>.html.eta`:
a complete, self-contained document with all its CSS in one inline `<style>`
block. `template: <name>` in frontmatter selects one; `--template` overrides it.

The layout *is* the template. There is no intermediate description of it.

```
templates/<name>.html.eta   →   error listing what exists
```

Templates that ship with the repo and templates you write are the same kind of
file in the same directory, so there is no shadowing rule and nothing to bundle.
`resume-tools templates` lists them. Four ship today: `sharp` (two-column header,
shaded contact band, colored links), `classic` (centered serif, ruled headings),
`minimal` (sparse, rule-free), `default` (plain).

**What a template receives** (`src/template/render.ts`) is the model plus a small
helper object, and nothing else:

```
it.contact   it.sections   it.meta
it.fmt       dates() meta() channels() join() upper() lower()
```

`it.fmt` exists so date and contact formatting stay consistent across templates
rather than being reinvented — and reinvented differently — in each one.

Eta runs with `autoEscape`, so `<%= %>` escapes and `<%~ %>` is an explicit
opt-out. Resume text goes through `<%= %>`; a bullet containing `<` or `&` cannot
break the document. A test asserts no shipped template uses `<%~`.

> **Rejected: a JSON style schema.** The first version of this described the
> design as structured data (`header.layout: 'two-column'`, `colors.band`, …) and
> generated CSS from it. It works, but it can only express the knobs someone
> thought to add: a sidebar, a photo, a skills meter or a timeline rail are all
> unreachable without schema changes plus renderer branches. An HTML/CSS template
> is what a layout actually is, Claude writes CSS far better than it fills in
> enum fields, and the result is editable by anyone who knows CSS.

**Why a name and not an inline block.** Every tailored variant would otherwise
carry a duplicate copy of the whole design, and re-theming would mean editing
each one. Indirection also means `tailor` needs to know nothing about layout at
all — `structuredClone` carries the reference for free.

### Templates are code, so their output is checked

`checkTemplateCoverage(resume, html)` strips the rendered HTML to visible text
and asserts every section name, entry title, org, and bullet in the model reached
the page. A template with a missing `else` branch drops your Skills section and
still produces a perfectly plausible resume; this turns that into a warning
naming the exact IDs. `build` runs it on every render.

## Claude integration

`src/claude.ts` — one wrapper, one place where SDK config lives.

```ts
ask<T>({ prompt, schema, tools?, effort? }): Promise<T>
```

Options set on every query, and why:

| Option | Value | Reason |
|---|---|---|
| `permissionMode` | `'bypassPermissions'` | the requested `--dangerously-skip-permissions` behavior |
| `outputFormat` | `{ type: 'json_schema', schema }` | typed results, no output parsing |
| `systemPrompt` | custom string | **not** the `claude_code` preset — we don't want coding-agent behavior |
| `settingSources` | `[]` | **important:** the default loads all sources, which would pull `~/.claude/CLAUDE.md`, skills, and hooks into every resume query |
| `allowedTools` | per-command, minimal | `import` needs `Read`; JD analysis needs none |
| `effort` | `'low'` for extraction, `'high'` for suggestions | cost/quality per step |

Auth is implicit — the SDK spawns the `claude` binary, which reads
`~/.claude/.credentials.json`. Preflight check on startup: if no credentials, fail
with "run `claude login`" rather than a confusing SDK error.

## Commands

### `resume-tools import <pdf> [--template-name <name>]`

1. **Content pass.** `ask()` with the `Read` tool over the PDF, `outputFormat` =
   Resume schema. Claude reads PDFs natively, which handles two-column and table
   layouts that `pdftotext` mangles.
2. **Layout pass** (`parse/template.ts`). Same PDF, different question: Claude
   writes an Eta template reproducing the design, given the data contract and the
   output rules verbatim in the prompt. Two passes rather than one because asking
   a single call for both reliably degrades the transcription.
3. **Coverage cross-check:** run `pdftotext -layout` and verify every substantive
   line appears in the extracted model. LLM extraction can silently drop a bullet;
   this catches it. Discrepancies are reported for review, not auto-accepted.
4. Serialize model → Markdown, mint IDs, write `resumes/base.resume.md` and
   `templates/<name>.html.eta`, with the resume pointing at the template.

The layout pass emits **code**, so it is verified rather than trusted.
`findTemplateFault` compiles the candidate, renders it against the real resume,
and rejects it if it throws, if the output is not a whole HTML document, or if
`checkTemplateCoverage` finds dropped content. The fault is fed back for one
repair attempt; a second failure is a hard error pointing at the built-in
templates rather than a silently broken file on disk.

The layout pass runs *after* the content pass, not concurrently with it, because
verification needs the real resume to render against.

### `resume-tools tailor <jd-file> [--from base.resume.md]`

Five checkpoints, each a place where you know something the tool cannot. `--yes`
skips all of them; so does a non-TTY stdin, which is detected rather than
deadlocking on a prompt nobody can answer.

**Ctrl-C means "go back", not "die"** — anywhere, including mid-request. It
raises `Interrupted`, the runner catches it and opens the stage navigator. Only
the navigator's own *quit* raises `Cancelled` and ends the run. Two error types
rather than one because "I want out of this prompt" and "I want out of this
program" are different intentions that Ctrl-C had been conflating.

| Stage | Kind | Output |
|---|---|---|
| `analyze-jd` | Claude, low effort | `JobSpec { title, seniority, hardRequirements[], niceToHaves[], keywords[], domain }` |
| **1. confirm-jd** | **you** | the spec, editable. Everything downstream derives from it, so a misread posting is worth catching here rather than in the output |
| `coverage` | Claude, structured | requirement → evidence bullet IDs, or explicit gap |
| **2. interview** | **you** | pick the gaps you can actually speak to, answer in your own words → new facts. "No evidence in the resume" and "no experience" are different things |
| `suggest` | Claude, high effort | `Suggestion[]` — see below; facts are citable sources |
| `verify` | Claude, low effort, **fresh context** | given only the sources for one proposed bullet: does it assert anything unsupported? |
| **3. rejections** | **you** | what the check cut, and why. Keeping one re-attributes the claim to you rather than skipping the check |
| **4. review** | **you** | accept / edit / reject / add, per suggestion, with back-navigation |
| **5. additions** | **you** | bullets, list lines or whole entries that no suggestion could propose |
| `apply` | deterministic | patch model, write variant + reports |
| **write-back** | **you** | promote what you added into the base resume, placed where it already sits in the variant |

```ts
Suggestion {
  targetId: string
  kind: 'rewrite' | 'reorder' | 'promote' | 'demote' | 'drop' | 'add'
  before, after: string
  sourceIds: string[]     // must be non-empty — the fabrication guard
  rationale: string
  jdRef: string           // the JD requirement this serves
  confidence: number
  origin?: 'model' | 'user'   // ours to set, not the model's to claim
}
```

`add` is the only kind that creates content, and `filterKnownSuggestions`
requires at least one of its `sourceIds` to be a fact ID. An `add` sourced only
from existing bullets would be padding — restating what the resume already says
— which is the same failure the fabrication guard exists to stop.

`origin` is deliberately outside the zod schema the model fills in. A `user`
suggestion skips verification, so letting the model set it would be a hole
straight through principle 3.

### Going back

`run.ts` is a loop over a stage cursor, not a straight line. An `Interrupted`
from any stage opens the navigator:

```
── interrupted ───────────────────────────────────────────────────────

  Going back re-runs the model only for what you actually change —
  return to a stage, change nothing, and the earlier results are reused.

? Where to?
❯ resume 3/5 Cut
    ── go back to ──
  1/5 Job          Senior Full Stack Engineer · 17 must-have(s)
  2/5 Gaps         6 gap(s) · 2 answered
  ──────────────
  stop here and write what I have
  quit without writing anything
```

Only stages *behind* the cursor are offered; jumping forward would skip the work
a later stage depends on. Ctrl-C at the navigator itself means "never mind" and
resumes.

**Nothing is recomputed unless its inputs moved.** Each derived result carries a
cache key of the inputs that produced it — coverage keys on the job spec,
suggestions on the job spec plus the current facts. Go back to stage 1, look at
the spec, change nothing, and coverage and suggestions are reused; change the
title and both re-run. Comparing inputs beats hand-maintaining a table of what
invalidates what, which is the kind of table that silently goes stale.

**Re-entering a stage keeps its work.** Review re-seeds every verdict you had
already given (`seedSlots`), including bullets you wrote yourself, which live
only in the decision list and appear in no regenerated suggestion set. The gap
interview keeps a run-scoped map of requirement → fact so it asks only about
what is still unanswered — and unpicking an answer retracts its fact instead of
orphaning it. Additions accumulate. Without this, going back would be a punishment
and you would stop doing it.

> **Why Ctrl-C rather than a key like Esc.** Inquirer's prompts do not surface
> Esc uniformly, and a long `suggest` call is not a prompt at all — there is no
> readline to press a key into. `SIGINT` is the one signal available in both
> situations. The spinner listens for it *only while spinning*, so outside that
> window inquirer's own handling and the default behaviour are untouched, and a
> second Ctrl-C during the same wait exits outright so a wedged request cannot
> trap you.

### Review

```
━━ 3/5 Suggestions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ 2  ✎ 1  ✗ 0  — 0   8 left
┌─ Suggestion 3 of 11 ─────────────────── confidence ▓▓▓▓▓░ 0.82 ─┐
│ r1b2 · rewrite · Experience › Staff Engineer — Acme             │
└─────────────────────────────────────────────────────────────────┘

  before  Built internal data pipeline for the analytics team
  after   Built real-time ETL pipeline processing 2M events/day for
          the analytics team

  why     The posting leads on streaming volume, and this bullet is
          the only place the resume touches ingest throughput.
  jd      "experience with streaming data at scale"
  source  r1b1 ✓ no new claims

❯ accept
  edit …
  reject
  add a bullet here instead
  ─────────────
  back to #2
  skip for now
  stop here and apply what I have decided
```

Before/after on two lines rather than one interleaved diff: a bullet is a
sentence you have to be able to *read* to judge, and interleaving makes both
versions unreadable at once. Word-level emphasis carries what changed.

A decision is not final — `back` re-opens an earlier one — because the eleventh
suggestion routinely changes your mind about the third.

Also emits: **match report** (requirement → evidence, plus honest gaps to prep
talking points for), **keyword coverage** (JD hard keywords absent from the resume,
so you can surface real experience in their vocabulary), and a **cover letter draft**
grounded strictly in the tailored variant's existing claims.

**The variant and your facts are written first, and reports are best-effort.**
The cover letter used to *throw* when it failed its own grounding check, which
took the whole run down with it — after you had answered five stages of
questions. A rejected draft is now written with the objection quoted at the top,
and any report that fails is a warning, not an exit. Nothing you typed is lost
to a report generator.

### Console

`@inquirer/prompts` for input, plus `src/ui/chrome.ts` for panels, rules,
aligned fields, meters and diffs. Chrome lays out against *visible* width — ANSI
escapes are stripped before measuring, and styling is carried as a token list so
text can be wrapped and boxed after it is coloured. Getting this wrong is how
box-drawn UIs end up ragged in exactly the cases that matter.

**Spinners** (`src/ui/spinner.ts`) wrap every Claude call and the Chrome print.
The stages are sequential and each runs from a few seconds to the better part of
a minute, so without one the terminal looks hung. `withSpinner(label, work)`
shows a frame, the label, and an elapsed counter — the counter is the part that
says "alive", so it is not optional. Past six seconds it rotates a dim second
word (`crunching`, `combobulating`, …) through the wait.

Hand-rolled rather than a dependency: it is a frame list, an interval and two
escape codes, it shares a stream with `@inquirer`, and it has to be
*interruptible* — all easier to guarantee when we own the writes. The interval
is `unref`'d so the animation can never be what keeps the process alive, the
cursor is restored on `exit`, and a non-TTY gets one plain `… label` line
instead of twelve writes a second into a log file.

`withSpinner(label, work)` hands `work` an `AbortSignal`, which `ask()` wires to
the SDK's `abortController`. Cancelling for real matters: a `suggest` call
abandoned at 40 seconds would otherwise keep running, and a second would start
beside it when the stage is re-entered.

> **Ordering trap, and the test that caught it.** The interrupt handler must
> `reject(new Interrupted())` *before* calling `controller.abort()`. Aborting
> settles the work promise synchronously, and `Promise.race` reports whichever
> settled first — abort first and the caller gets the request's own cancellation
> error rather than an `Interrupted` it can act on. The two lines look
> interchangeable and are not.

> **Amended: "no TUI framework".** The original rule was right about `ink` — a
> React runtime and a rewrite of the command's control flow into components, for
> a program that asks questions and prints answers. It was wrong to extend to
> prompts. The interactive flow needs select, checkbox, editable-prefill input,
> confirm and `$EDITOR` handoff; hand-rolling those over raw `readline` is where
> the old single-keypress review already fell over. A prompt library is not a
> TUI framework. There is still no full-screen mode, no alternate screen buffer,
> and no component tree.

### Errors

`line 1: unrecognized syntax` names neither the file nor the line, and by far
its commonest cause is a resume command pointed at a job description.
`ResumeParseError` carries the line *and its text*, and `looksLikeResume` — does
it have frontmatter with a `name`, or any `## Section`? — separates "malformed
resume" from "not a resume", so the second gets the message it deserves:

```
✗ jds/acme.md does not look like a resume

  It has no YAML frontmatter with a `name:` and no `## Section` headings, so
  there is nothing here to parse as a resume.

  1 │ Our Product:

  did you mean
    npm run cli -- tailor jds/acme.md
```

### `resume-tools lint <resume.md> [--all]`

Writing checks that hold whatever the job: weak openers, tense (past for a
finished role, one tense per current role), first person, filler, phrases that
undercut the claim, trailing "demonstrating X" clauses, length, repeated opening
verbs, and bullets that state no result. `src/lint/bullets.ts`, no model.

Deterministic because principle 6 says so, and because a check that gives the
same answer twice is one you can act on. The heuristics lean quiet: tense is
judged only for opening words known to be verbs, and "no result" is info rather
than a warning, folded into a count by default — it is true of most bullets on
most resumes, and listed one per bullet it buried everything else.

`suggest` receives the warnings and a short writing guide, so tailoring fixes
the bullets it touches and may propose a rewrite for a warning alone. It does
not receive `no-outcome`: asking the model to add a result is asking it to
invent one. Answering that question is a job for a future quantification
interview, whose answers would be facts.

### `resume-tools build <resume.md> [--format pdf,html,md] [--template <name>]`

One path, which is the point:

```
model + template ──▶ Eta ──▶ HTML ──┬──▶ headless Chrome ──▶ .pdf
                                    └──▶ .html
model ──────────────────────────────────────────────────────▶ .md
```

Chrome prints with `printBackground` and `preferCSSPageSize`, so `@page` owns the
page box and shaded bands survive. `emulateMediaType('print')` is required —
without it Chrome renders the screen cascade and ignores `@page` entirely.

`--format md` is not a copy: it re-serializes the parsed model, normalizing
spacing and ID comments.

> **Two reversed decisions live here.** This began as DOCX → `soffice
> --convert-to pdf`, on the reasoning that one layout engine guarantees DOCX and
> PDF match. That guarantee was the problem: it capped the PDF at what the `docx`
> library and LibreOffice could *both* express, which is not enough for a
> two-column header. PDF moved to Chrome, and DOCX was then dropped outright
> rather than maintained as a second, permanently-inferior rendering path. The
> cost of Chrome is a ~1.3 GB bundled Chromium; set `PUPPETEER_EXECUTABLE_PATH`
> to reuse a system one.
>
> Dropping DOCX means there is no ATS-plain output. If that becomes a problem,
> the honest fix is a dedicated plain template, not a second renderer.

## Layout

```
src/
  cli.ts                    commander entry
  claude.ts                 Agent SDK wrapper + preflight auth check
  config.ts                 output dirs + PDF name pattern; flag > env > file
  model/
    schema.ts               zod Resume schema
    ids.ts                  minting + content-hash stability
  parse/
    pdf.ts                  Claude-driven PDF → Resume + coverage cross-check
    template.ts             Claude-driven PDF → Eta template, verified by rendering
    markdown.ts             Markdown ⇄ Resume (deterministic, strict)
  template/
    load.ts                 name → template source; listing, writing
    render.ts               Eta merge + rendered-output coverage check
  render/
    format.ts               dates, contact channels — the `it.fmt` helpers
    pdf.ts                  HTML → PDF via headless Chrome
  tailor/
    run.ts                  the five checkpoints, in order
    analyze-jd.ts  coverage.ts  suggest.ts  verify.ts  apply.ts
    facts.ts                facts.md parse/serialize + FactStore
    confirm-jd.ts           checkpoint 1
    interview.ts            checkpoint 2
    rejections.ts           checkpoint 3
    review.ts               checkpoint 4
    additions.ts            checkpoint 5
    writeback.ts            promote variant additions into the base
  ui/
    chrome.ts               panels, rules, fields, meters, diffs
    interrupt.ts            Interrupted (go back) vs Cancelled (stop)
    prompts.ts              themed @inquirer wrappers; Ctrl-C → Interrupted
    spinner.ts              withSpinner(), interruptible, aborts its work
    errors.ts               actionable parse-error rendering
    lint.ts                 the lint report
  lint/
    bullets.ts              deterministic writing checks
  report/
    match.ts  keywords.ts  cover-letter.ts
templates/*.html.eta        shipped and hand-written alike
resumes/base.resume.md
resumes/facts.md            claims you supplied, not yet in the resume
resumes/variants/*.resume.md
resumes/pdfs/               printed PDFs — the files you send
out/                        html, normalized markdown, reports
```

## Dependencies

`@anthropic-ai/claude-agent-sdk`, `commander`, `zod`, `zod-to-json-schema`,
`gray-matter`, `eta`, `puppeteer`, `diff`, `picocolors`, `@inquirer/prompts`.
Dev: `tsx`, `vitest`, `typescript`.

No LibreOffice, no pandoc, no DOCX, no full-screen TUI framework.

## Build order

**M1 — foundation, zero Claude.** Schema, Markdown parser/serializer, template
layer and PDF renderer. Round-trip test: parse → serialize → parse is a fixed
point. Hand-write a `base.resume.md` and get a real PDF out. This is the part that
must be exactly correct, and it's fully testable without a model.

**M2 — import.** PDF → model, with the `pdftotext` coverage check, and PDF →
template, verified by rendering.

**M3 — tailor.** JD analysis → coverage → suggestions → verify → the five
interactive checkpoints → apply → write-back, then
the three reports.

Each milestone is independently useful: M1 alone already gives you a versioned
resume with clean multi-format export.
