import { describe, it, expect } from 'vitest';
import {
  looksLikeDocx,
  looksLikeLegacyDoc,
  looksLikePdf,
  normalizePdfText,
} from '../../src/parse/jd.js';

describe('looksLikePdf', () => {
  it('recognizes a PDF by its header, whatever the file is called', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1'))).toBe(true);
  });

  it('does not mistake a markdown job description for a PDF', () => {
    expect(looksLikePdf(Buffer.from('# Senior Engineer\n\nWe are hiring.\n'))).toBe(false);
  });

  it('handles a file too short to hold a header', () => {
    expect(looksLikePdf(Buffer.from(''))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PDF'))).toBe(false);
  });
});

describe('looksLikeDocx', () => {
  it('recognizes the zip local-file header a .docx opens with', () => {
    expect(looksLikeDocx(Buffer.from('PK\x03\x04\x14\x00', 'latin1'))).toBe(true);
  });

  it('does not mistake markdown or a PDF for a docx', () => {
    expect(looksLikeDocx(Buffer.from('# Senior Engineer\n'))).toBe(false);
    expect(looksLikeDocx(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe(false);
  });

  it('handles a file too short to hold a header', () => {
    expect(looksLikeDocx(Buffer.from(''))).toBe(false);
    expect(looksLikeDocx(Buffer.from('PK'))).toBe(false);
  });
});

describe('looksLikeLegacyDoc', () => {
  it('recognizes the OLE compound-file header of a binary .doc', () => {
    expect(
      looksLikeLegacyDoc(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe(true);
  });

  it('does not fire on plain text', () => {
    expect(looksLikeLegacyDoc(Buffer.from('We are hiring.\n'))).toBe(false);
  });
});

describe('normalizePdfText', () => {
  it('strips the trailing padding -layout leaves on every line', () => {
    expect(normalizePdfText('Senior Engineer      \n  Remote   \t\n')).toBe(
      'Senior Engineer\n  Remote',
    );
  });

  it('turns page breaks into a paragraph break rather than a stray glyph', () => {
    expect(normalizePdfText('Requirements\n\f\nBenefits\n')).toBe('Requirements\n\nBenefits');
  });

  it('collapses the blank runs left by header and footer margins', () => {
    expect(normalizePdfText('About us\n\n\n\n\nThe role\n')).toBe('About us\n\nThe role');
  });

  it('normalizes CRLF line endings', () => {
    expect(normalizePdfText('One\r\nTwo\r\n')).toBe('One\nTwo');
  });

  it('reports an image-only extraction as empty', () => {
    expect(normalizePdfText('\f\n   \n\f')).toBe('');
  });
});
