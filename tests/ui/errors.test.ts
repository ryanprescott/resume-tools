import { describe, it, expect } from 'vitest';
import { renderParseError } from '../../src/ui/errors.js';
import { looksLikeResume, parseMarkdown, ResumeParseError } from '../../src/parse/markdown.js';
import { renderCoverLetter } from '../../src/report/cover-letter.js';

const STRIP = /\[[0-9;]*m/g;
const plain = (s: string): string => s.replace(STRIP, '');

const JD = 'Our Product:\nWe started in payroll and grew from there.\n';
const BAD_RESUME = [
  '---',
  'name: Jane Doe',
  '---',
  '',
  '## Experience',
  '',
  '### Staff Engineer at Acme  <!--id:r1-->',
  '2023-01 .. present',
  '',
  '- Did a thing  <!--id:r1b1-->',
].join('\n');

function parseError(source: string): unknown {
  try {
    parseMarkdown(source);
  } catch (err) {
    return err;
  }
  throw new Error('expected a parse error');
}

describe('looksLikeResume', () => {
  it('is false for a job description', () => {
    expect(looksLikeResume(JD)).toBe(false);
  });

  it('is true when frontmatter carries a name', () => {
    expect(looksLikeResume('---\nname: Jane Doe\n---\n\nnonsense\n')).toBe(true);
  });

  it('is true when the body has a section heading', () => {
    expect(looksLikeResume('## Experience\n\n- a bullet\n')).toBe(true);
  });

  it('is not fooled by a bare "##" or a markdown h1', () => {
    expect(looksLikeResume('# Title\n\nsome prose\n')).toBe(false);
    expect(looksLikeResume('##\n\nsome prose\n')).toBe(false);
  });
});

describe('renderParseError', () => {
  it('says the file is not a resume, and suggests what to run instead', () => {
    const out = plain(
      renderParseError(parseError(JD), {
        file: 'jds/acme.md',
        source: JD,
        suggestion: 'npm run cli -- tailor jds/acme.md',
      })!,
    );
    expect(out).toContain('jds/acme.md does not look like a resume');
    expect(out).toContain('did you mean');
    expect(out).toContain('npm run cli -- tailor jds/acme.md');
    expect(out).toContain('Our Product:');
  });

  it('reports a genuine syntax error against the grammar instead', () => {
    const out = plain(
      renderParseError(parseError(BAD_RESUME), { file: 'a.resume.md', source: BAD_RESUME })!,
    );
    expect(out).toContain('a.resume.md is not valid resume Markdown');
    expect(out).toContain('line 7');
    expect(out).toContain('### Staff Engineer at Acme');
    expect(out).not.toContain('did you mean');
  });

  it('omits the excerpt when the offending line is unknown', () => {
    const err = new ResumeParseError(12, '', 'expected entry meta line');
    const out = plain(renderParseError(err, { file: 'a.resume.md', source: BAD_RESUME })!);
    expect(out).toContain('line 12');
    expect(out).not.toContain('│');
  });

  it('returns null for an error it does not own', () => {
    expect(renderParseError(new Error('disk on fire'), { file: 'a.md', source: '' })).toBeNull();
  });
});

describe('renderCoverLetter', () => {
  it('passes an approved draft through untouched', () => {
    expect(renderCoverLetter({ letter: 'Dear team,', approved: true, reason: '' })).toBe('Dear team,');
  });

  it('prefixes a rejected draft with the objection rather than discarding it', () => {
    const out = renderCoverLetter({
      letter: 'Dear team,',
      approved: false,
      reason: 'overstates AWS experience',
    });
    expect(out).toContain('did not pass the grounding check');
    expect(out).toContain('> overstates AWS experience');
    expect(out).toContain('Dear team,');
  });
});
