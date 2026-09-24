import { flattenBullets } from '../model/flatten.js';
import type { Bullet, Entry, Resume } from '../model/schema.js';

/**
 * Writing checks over a parsed resume — the things a recruiter marks down that
 * have nothing to do with any particular job: a bullet that opens with
 * "Responsible for", tense that wanders inside one role, filler adjectives, a
 * summary nobody reads to the end.
 *
 * Deterministic on purpose (principle 6). None of this needs a model, and a
 * check that gives the same answer twice is one you can act on and one a test
 * can pin down. The heuristics lean towards staying quiet: a missed weak bullet
 * costs little, a linter that cries wolf gets ignored.
 */

export type Severity = 'warn' | 'info';

export type Rule =
  | 'weak-opener'
  | 'tense'
  | 'first-person'
  | 'filler'
  | 'undercut'
  | 'skill-tail'
  | 'length'
  | 'no-outcome'
  | 'repeated-opener';

export interface Finding {
  /** The bullet the finding is about. */
  id: string;
  rule: Rule;
  /** `warn` is worth fixing; `info` is a prompt to look, often answerable only by you. */
  severity: Severity;
  message: string;
}

/** Past the point where a bullet stops being skimmable. */
export const MAX_BULLET_WORDS = 30;
/** Two to three lines of a summary at resume type sizes. */
export const MAX_SUMMARY_WORDS = 60;
/** The same verb opening this many bullets reads as a template. */
const REPEAT_THRESHOLD = 3;

const WEAK_OPENER =
  /^(responsible for|worked on|working on|helped|helping|assisted|assisting|tasked with|duties included|involved in|participated in|in charge of)\b/i;

const FILLER = [
  'results-driven',
  'results-oriented',
  'detail-oriented',
  'hard-working',
  'hardworking',
  'passionate',
  'team player',
  'self-starter',
  'go-getter',
  'synergy',
  'think outside the box',
  'proven track record',
  'highly motivated',
  'successfully',
  'various',
];

/** Phrases that argue against the claim they sit in. */
const UNDERCUT = [
  'no formal experience',
  'no prior experience',
  'despite having no',
  'tried to',
  'attempted to',
  'basic knowledge',
  'some experience',
];

/** A trailing clause that names a skill instead of showing it: "…, demonstrating leadership". */
const SKILL_TAIL = /,?\s+\b(demonstrating|showcasing|highlighting|showing|exhibiting)\b/i;

// "I" is matched case-sensitively, so the "i" in "i.e." is not a pronoun.
const FIRST_PERSON = /(?<![\w/])(I|I'm|I've|I'd)(?![\w/.])|\b([Mm]e|[Mm]y|[Mm]ine|[Mm]yself)\b/;

const NUMBER = /\d|\b(dozens?|hundreds?|thousands?|millions?|billions?)\b/i;

const OUTCOME =
  /\b(reduc|increas|improv|cut|sav|grew|grow|doubl|tripl|halv|accelerat|enabl|result|boost|lower|rais|faster|fewer|acquir|won|award|launch|adopt)\w*/i;

const ONGOING_END = /^(present|current|now|ongoing|today)$/i;

// ── Tense ───────────────────────────────────────────────────────────────────

/** Base forms of the verbs resumes open with. Tense is only judged for these. */
const VERBS = new Set(
  (
    'administer analyze architect assist audit automate bridge bring build champion coach collaborate ' +
    'communicate configure contribute coordinate create cut debug define deliver deploy design ' +
    'develop document drive embed enable engineer establish evaluate execute facilitate generate ' +
    'grow guide handle help hire implement improve increase install integrate interface introduce ' +
    'investigate launch lead learn leverage maintain make manage mentor migrate model modernize ' +
    'monitor negotiate operate optimize orchestrate own partner plan prepare present produce ' +
    'prototype provide publish rebuild recruit reduce refactor research resolve review run save ' +
    'scaffold scale schedule secure sell serve set ship simplify solve spearhead streamline support ' +
    'teach test train transform troubleshoot upgrade use win work write'
  ).split(' '),
);

const IRREGULAR_PAST = new Set(
  'built led ran wrote made drove grew cut set sold taught brought found held kept met paid spent spoke began became chose rebuilt won gave took did oversaw sent stood understood drew undertook'.split(
    ' ',
  ),
);

export type Tense = 'past' | 'present' | 'gerund';

/** The tense of a bullet's opening verb, or null when it does not open with one we know. */
export function openingTense(text: string): Tense | null {
  const word = firstWord(text);
  if (word === '') return null;
  if (IRREGULAR_PAST.has(word)) return 'past';
  if (VERBS.has(word)) return 'present';
  if (word.length > 4 && word.endsWith('ed')) return 'past';
  if (word.length > 4 && word.endsWith('ing')) return 'gerund';
  if (word.endsWith('ies') && VERBS.has(word.slice(0, -3) + 'y')) return 'present';
  if (word.endsWith('es') && VERBS.has(word.slice(0, -2))) return 'present';
  if (word.endsWith('s') && VERBS.has(word.slice(0, -1))) return 'present';
  return null;
}

function firstWord(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

function openerLabel(text: string): string {
  return text.trim().split(/\s+/)[0] ?? '';
}

/**
 * A finished role reads in the past tense. A current one may use either, but
 * one of them — mixing "Built" and "Leverages" under the same heading is the
 * thing that reads as careless. Present tense and "-ing" openers are the same
 * side of that line: both describe something still going on.
 */
function tenseFindings(entry: Entry): Finding[] {
  const tenses = entry.bullets.map((b) => ({ bullet: b, tense: openingTense(b.text) }));
  const findings: Finding[] = [];

  if (!ONGOING_END.test(entry.end.trim())) {
    for (const { bullet, tense } of tenses) {
      if (tense === 'present' || tense === 'gerund') {
        findings.push({
          id: bullet.id,
          rule: 'tense',
          severity: 'warn',
          message: `"${openerLabel(bullet.text)}" — this role has ended, so write it in the past tense`,
        });
      }
    }
    return findings;
  }

  const past = tenses.filter((t) => t.tense === 'past').length;
  const ongoing = tenses.filter((t) => t.tense === 'present' || t.tense === 'gerund').length;
  if (past === 0 || ongoing === 0) return findings;

  // On a tie, past wins: finished accomplishments are the stronger convention.
  const majority: 'past' | 'ongoing' = past >= ongoing ? 'past' : 'ongoing';
  for (const { bullet, tense } of tenses) {
    if (tense === null) continue;
    const side = tense === 'past' ? 'past' : 'ongoing';
    if (side === majority) continue;
    findings.push({
      id: bullet.id,
      rule: 'tense',
      severity: 'warn',
      message:
        majority === 'past'
          ? `"${openerLabel(bullet.text)}" — most bullets in this role are past tense; match them`
          : `"${openerLabel(bullet.text)}" — most bullets in this role are present tense; match them`,
    });
  }
  return findings;
}

// ── Per-bullet checks ───────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function phraseIn(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text);
}

/** Checks that apply to any prose: an experience bullet or a summary. */
function proseFindings(bullet: Bullet): Finding[] {
  const findings: Finding[] = [];
  const { id, text } = bullet;

  const person = text.match(FIRST_PERSON);
  if (person) {
    findings.push({ id, rule: 'first-person', severity: 'warn', message: `"${person[0]}" — resumes drop the first person` });
  }
  const filler = FILLER.filter((phrase) => phraseIn(text, phrase));
  if (filler.length > 0) {
    findings.push({
      id,
      rule: 'filler',
      severity: 'warn',
      message: `${filler.map((f) => `"${f}"`).join(', ')} — says nothing a reader can check; cut or show it`,
    });
  }
  const undercut = UNDERCUT.find((phrase) => phraseIn(text, phrase));
  if (undercut) {
    findings.push({ id, rule: 'undercut', severity: 'warn', message: `"${undercut}" — argues against your own claim; cut it` });
  }
  return findings;
}

function experienceFindings(bullet: Bullet): Finding[] {
  const findings = proseFindings(bullet);
  const { id, text } = bullet;

  const weak = text.match(WEAK_OPENER);
  if (weak) {
    findings.push({
      id,
      rule: 'weak-opener',
      severity: 'warn',
      message: `opens with "${weak[0]}" — lead with the verb for what you did`,
    });
  }
  const tail = text.match(SKILL_TAIL);
  if (tail) {
    findings.push({
      id,
      rule: 'skill-tail',
      severity: 'warn',
      message: `"${tail[1]} …" names a skill instead of showing it; let the bullet show it, or cut the clause`,
    });
  }
  const words = wordCount(text);
  if (words > MAX_BULLET_WORDS) {
    findings.push({
      id,
      rule: 'length',
      severity: 'warn',
      message: `${words} words — over ${MAX_BULLET_WORDS} gets skimmed; split it or cut to the result`,
    });
  }
  if (!NUMBER.test(text) && !OUTCOME.test(text)) {
    findings.push({
      id,
      rule: 'no-outcome',
      severity: 'info',
      message: 'says what you did, not what came of it — is there a number (users, %, time, $, volume)?',
    });
  }
  return findings;
}

function isSummary(name: string): boolean {
  return /\b(summary|profile|about|objective)\b/i.test(name);
}

// ── The whole resume ────────────────────────────────────────────────────────

/**
 * Every finding, in document order. Bare-bullet sections other than a summary
 * (Skills, Languages, Certifications) are lists rather than prose, and are not
 * checked.
 */
export function lintResume(resume: Resume): Finding[] {
  const findings: Finding[] = [];
  /** Opening verb → the bullets it opens, in document order. */
  const openers = new Map<string, Bullet[]>();

  for (const section of resume.sections) {
    if (section.bullets) {
      if (!isSummary(section.name)) continue;
      for (const bullet of section.bullets) {
        findings.push(...proseFindings(bullet));
        const words = wordCount(bullet.text);
        if (words > MAX_SUMMARY_WORDS) {
          findings.push({
            id: bullet.id,
            rule: 'length',
            severity: 'warn',
            message: `summary is ${words} words — aim for two or three lines (under ${MAX_SUMMARY_WORDS})`,
          });
        }
      }
      continue;
    }

    for (const entry of section.entries ?? []) {
      for (const bullet of entry.bullets) {
        findings.push(...experienceFindings(bullet));
        if (openingTense(bullet.text) !== null) {
          const verb = firstWord(bullet.text);
          openers.set(verb, [...(openers.get(verb) ?? []), bullet]);
        }
      }
      findings.push(...tenseFindings(entry));
    }
  }

  // One finding per overused verb, not one per bullet: the fix is to vary the
  // set, and eight copies of the same line would bury everything else.
  for (const bullets of openers.values()) {
    if (bullets.length < REPEAT_THRESHOLD) continue;
    findings.push({
      id: bullets[REPEAT_THRESHOLD - 1].id,
      rule: 'repeated-opener',
      severity: 'info',
      message: `"${openerLabel(bullets[0].text)}" opens ${bullets.length} bullets (${bullets.map((b) => b.id).join(', ')}) — vary the verb`,
    });
  }

  const order = new Map(flattenBullets(resume).map((b, i) => [b.id, i]));
  return findings
    .map((finding, i) => ({ finding, i }))
    .sort((a, b) => (order.get(a.finding.id) ?? 0) - (order.get(b.finding.id) ?? 0) || a.i - b.i)
    .map(({ finding }) => finding);
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  return {
    warn: findings.filter((f) => f.severity === 'warn').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

/**
 * Warnings as the `suggest` prompt sees them. Info-level findings are left out:
 * "is there a number?" is a question for you, and handing it to the model is
 * how a number with no antecedent ends up in a bullet.
 */
export function lintBrief(findings: readonly Finding[]): string {
  return findings
    .filter((f) => f.severity === 'warn')
    .map((f) => `${f.id}: [${f.rule}] ${f.message}`)
    .join('\n');
}
