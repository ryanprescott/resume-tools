import { describe, it, expect } from 'vitest';
import { AUTO_FIT_MAX, FIT_MAX, countPdfPages, describeFit, fitSettings } from '../../src/render/pdf.js';

describe('fitSettings', () => {
  it('is the template as designed at 0', () => {
    expect(fitSettings(0)).toEqual({ spacing: 1, margins: 1, lineHeight: 1, fontSize: 1 });
  });

  it('spends whitespace before leading, and leading before type size', () => {
    const one = fitSettings(1);
    expect(one.spacing).toBeLessThan(1);
    expect(one.margins).toBeLessThan(1);
    expect(one.lineHeight).toBe(1);
    expect(one.fontSize).toBe(1);

    const two = fitSettings(2);
    expect(two.lineHeight).toBeLessThan(1);
    expect(two.fontSize).toBe(1);

    expect(fitSettings(FIT_MAX).fontSize).toBeLessThan(1);
  });

  it('never loosens as the dial turns, so bisection is sound', () => {
    let prev = fitSettings(0);
    for (let t = 0.1; t <= FIT_MAX; t += 0.1) {
      const next = fitSettings(t);
      for (const k of Object.keys(next) as Array<keyof typeof next>) expect(next[k]).toBeLessThanOrEqual(prev[k]);
      prev = next;
    }
  });

  it('stops at the floors past the end of the dial', () => {
    expect(fitSettings(FIT_MAX + 5)).toEqual(fitSettings(FIT_MAX));
    expect(fitSettings(FIT_MAX).fontSize).toBeGreaterThanOrEqual(0.8);
  });
});

describe('countPdfPages', () => {
  it('counts page objects and not the page tree', () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>\n' +
        '2 0 obj << /Type /Page /Parent 1 0 R >>\n3 0 obj <</Type/Page/Parent 1 0 R>>\n',
      'latin1',
    );
    expect(countPdfPages(pdf)).toBe(2);
  });
});

describe('describeFit', () => {
  const pdf = Buffer.alloc(0);

  it('says when nothing needed changing', () => {
    expect(describeFit({ pdf, html: '', pages: 1, naturalPages: 1 }, 2)).toMatch(/fits in 2 pages as designed/);
  });

  it('lists only the knobs that moved', () => {
    const line = describeFit(
      { pdf, html: '', pages: 1, naturalPages: 2, fit: { spacing: 0.7, margins: 0.8, lineHeight: 1, fontSize: 1 } },
      1,
    );
    expect(line).toBe('fitted 2 pages into 1 page: spacing 70%, margins 80%');
  });

  it('says nothing when there was no budget and nothing automatic happened', () => {
    expect(describeFit({ pdf, html: '', pages: 3, naturalPages: 3 })).toBeNull();
  });

  it('says when it took back a nearly empty last page, and how to stop it', () => {
    const line = describeFit({
      pdf,
      html: '',
      pages: 2,
      naturalPages: 3,
      auto: true,
      fit: { spacing: 0.8, margins: 0.9, lineHeight: 1, fontSize: 1 },
    });
    expect(line).toBe('pulled a nearly empty page 3 back: 2 pages with spacing 80%, margins 90% (--no-fit to keep it as designed)');
  });

  it('does not claim "spacing 100%" for a nudge too small to round', () => {
    const line = describeFit({
      pdf,
      html: '',
      pages: 2,
      naturalPages: 3,
      auto: true,
      fit: { spacing: 0.998, margins: 0.999, lineHeight: 1, fontSize: 1 },
    });
    expect(line).toMatch(/with spacing tightened by under 1%/);
  });

  it('never touches the type size automatically', () => {
    expect(fitSettings(AUTO_FIT_MAX).fontSize).toBe(1);
  });

  it('warns instead of pretending when it cannot fit', () => {
    expect(describeFit({ pdf, html: '', pages: 3, naturalPages: 3, overflow: true }, 1)).toMatch(/^⚠.*cut some content/);
  });
});
