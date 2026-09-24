import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/parse/markdown.js';
import { lintBrief, lintResume, openingTense, type Finding, type Rule } from '../../src/lint/bullets.js';

/** A resume with one entry holding `bullets`, ending `end`. */
function resumeWith(bullets: string[], end = '2023-01', extra = ''): ReturnType<typeof parseMarkdown> {
  const lines = bullets.map((text, i) => `- ${text}  <!--id:r1b${i + 1}-->`).join('\n');
  return parseMarkdown(`---
name: Jane Doe
---
${extra}
## Experience

### Engineer — Acme  <!--id:r1-->
2020-01 .. ${end}

${lines}
`);
}

const rules = (findings: Finding[], id?: string): Rule[] =>
  findings.filter((f) => id === undefined || f.id === id).map((f) => f.rule);

/** A bullet that trips nothing: past tense, a result, a number. */
const CLEAN = 'Cut p99 latency 40% by rewriting the ingest path';

describe('openingTense', () => {
  it.each([
    ['Built the ledger', 'past'],
    ['Led a team of 4', 'past'],
    ['Optimized queries', 'past'],
    ['Leverages Claude Code', 'present'],
    ['Maintains the pipeline', 'present'],
    ['Uses v0 for designs', 'present'],
    ['Build and run the platform', 'present'],
    ['Making architecture decisions', 'gerund'],
    ['Bring products to market', 'present'],
  ])('%s → %s', (text, tense) => {
    expect(openingTense(text)).toBe(tense);
  });

  it('does not guess at words it does not know as verbs', () => {
    expect(openingTense('Product acquired within a year')).toBeNull();
    expect(openingTense('Sales pipeline rebuilt')).toBeNull();
    expect(openingTense('APIs for billing')).toBeNull();
  });
});

describe('lintResume', () => {
  it('finds nothing wrong with a clean bullet', () => {
    expect(lintResume(resumeWith([CLEAN]))).toEqual([]);
  });

  it('flags a weak opener', () => {
    expect(rules(lintResume(resumeWith(['Responsible for the billing rewrite that cut costs 20%'])))).toContain(
      'weak-opener',
    );
  });

  it('flags first person, but not the "i" in "i.e." or I/O', () => {
    expect(rules(lintResume(resumeWith(['Cut costs 20% after I rewrote billing'])))).toContain('first-person');
    expect(rules(lintResume(resumeWith(['Cut my team’s costs 20%'])))).toContain('first-person');
    expect(rules(lintResume(resumeWith(['Cut I/O wait 30%, i.e. the main bottleneck'])))).not.toContain(
      'first-person',
    );
  });

  it('flags filler as a whole word only', () => {
    expect(rules(lintResume(resumeWith(['Successfully cut costs 20%'])))).toContain('filler');
    expect(rules(lintResume(resumeWith(['Cut costs 20% across variously sized teams'])))).not.toContain('filler');
  });

  it('flags a phrase that undercuts the claim', () => {
    expect(rules(lintResume(resumeWith(['Shipped a bot to 300 users despite having no formal experience'])))).toContain(
      'undercut',
    );
  });

  it('flags a trailing clause that names a skill instead of showing it', () => {
    const findings = lintResume(resumeWith(['Built a Gemini tool for 40 users, demonstrating LLM development']));
    expect(rules(findings)).toContain('skill-tail');
  });

  it('flags an overlong bullet', () => {
    const long = `Cut costs 20% ${'by doing a great many careful things '.repeat(5)}`;
    expect(rules(lintResume(resumeWith([long])))).toContain('length');
  });

  it('marks a bullet with no number and no result as info, not a warning', () => {
    const [finding] = lintResume(resumeWith(['Designed MongoDB queries for data flows']));
    expect(finding).toMatchObject({ rule: 'no-outcome', severity: 'info' });
  });

  it('counts number words and result verbs as outcomes', () => {
    expect(lintResume(resumeWith(['Indexed millions of trades a day']))).toEqual([]);
    expect(lintResume(resumeWith(['Reduced page load by rewriting the renderer']))).toEqual([]);
  });

  describe('tense', () => {
    it('wants a finished role in the past tense', () => {
      const findings = lintResume(resumeWith([CLEAN, 'Maintains the ledger that cut costs 20%'], '2023-01'));
      expect(rules(findings, 'r1b2')).toEqual(['tense']);
      expect(findings.find((f) => f.rule === 'tense')!.message).toContain('ended');
    });

    it('accepts a current role written entirely in the present tense', () => {
      const findings = lintResume(
        resumeWith(['Leads a team of 4', 'Maintains a ledger handling 2M trades a day'], 'present'),
      );
      expect(rules(findings)).not.toContain('tense');
    });

    it('flags the minority tense in a current role, with past winning a tie', () => {
      // A gerund opener counts as ongoing, on the same side as present tense.
      const findings = lintResume(resumeWith([CLEAN, 'Led a team of 4', 'Making 3 decisions a week'], 'present'));
      expect(rules(findings, 'r1b2')).toEqual([]);
      expect(rules(findings, 'r1b3')).toEqual(['tense']);

      const ongoing = lintResume(
        resumeWith([CLEAN, 'Maintains a ledger handling 2M trades a day', 'Making 3 decisions a week'], 'present'),
      );
      expect(ongoing.filter((f) => f.rule === 'tense').map((f) => f.id)).toEqual(['r1b1']);

      const tie = lintResume(resumeWith([CLEAN, 'Maintains a ledger handling 2M trades a day'], 'present'));
      expect(rules(tie, 'r1b1')).toEqual([]);
      expect(rules(tie, 'r1b2')).toEqual(['tense']);
    });
  });

  it('reports an overused opening verb once, naming every bullet', () => {
    const findings = lintResume(
      resumeWith(['Built a ledger for 3 banks', 'Built 2 APIs', 'Built a queue handling 1M jobs']),
    );
    const repeated = findings.filter((f) => f.rule === 'repeated-opener');
    expect(repeated).toHaveLength(1);
    expect(repeated[0].message).toContain('r1b1, r1b2, r1b3');
  });

  it('checks a summary for filler and length, but not for results', () => {
    const summary = `## Summary\n\n- Passionate engineer ${'who writes software '.repeat(20)} <!--id:s1-->\n`;
    const findings = lintResume(resumeWith([CLEAN], '2023-01', summary));
    expect(rules(findings, 's1').sort()).toEqual(['filler', 'length']);
  });

  it('leaves list sections such as Skills alone', () => {
    const skills = '## Skills\n\n- Various: TypeScript, Go, my favourite things  <!--id:s1-->\n';
    expect(lintResume(resumeWith([CLEAN], '2023-01', skills))).toEqual([]);
  });

  it('returns findings in document order', () => {
    const findings = lintResume(
      resumeWith(['Successfully built 2 APIs', 'Built a ledger for 3 banks', 'Built a queue for 1M jobs']),
    );
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('lintBrief', () => {
  it('passes warnings to the model and keeps questions only you can answer', () => {
    const findings = lintResume(resumeWith(['Successfully designed MongoDB queries']));
    const brief = lintBrief(findings);
    expect(brief).toContain('r1b1: [filler]');
    expect(brief).not.toContain('no-outcome');
  });
});
