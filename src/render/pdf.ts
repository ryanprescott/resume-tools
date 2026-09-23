import puppeteer, { type Browser, type Page } from 'puppeteer';

/**
 * Print styled HTML to PDF with headless Chrome. Chrome is the layout engine
 * for PDF so that templates can use real CSS.
 *
 * Set PUPPETEER_EXECUTABLE_PATH to use a system Chrome instead of the bundled one.
 */

async function launch(): Promise<Browser> {
  try {
    return await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--font-render-hinting=none'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `could not launch Chrome for PDF rendering: ${message}\n` +
        'Run `npx puppeteer browsers install chrome`, or point PUPPETEER_EXECUTABLE_PATH at a Chrome binary.',
    );
  }
}

async function print(page: Page): Promise<Buffer> {
  return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
}

/**
 * Chrome writes one uncompressed `/Type /Page` dictionary per page (the page
 * tree nodes are `/Type /Pages`), so counting them is exact without a PDF
 * parser — checked against `pdfinfo`.
 */
export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/**
 * How far each knob has been turned, as a fraction of its as-designed value.
 * 1 everywhere is the template exactly as written.
 */
export interface FitSettings {
  /** Vertical margins and padding between elements. */
  spacing: number;
  /** The `@page` margins. */
  margins: number;
  lineHeight: number;
  fontSize: number;
}

// Floors. Past these a resume stops looking designed and starts looking
// crammed, and the honest fix is cutting content, not shrinking it further.
const SPACING_MIN = 0.4;
const MARGINS_MIN = 0.6;
const LINE_HEIGHT_MIN = 0.87;
const FONT_SIZE_MIN = 0.85;

/** The whole schedule is `0 ..= FIT_MAX`; see `fitSettings`. */
export const FIT_MAX = 3;

/**
 * How far automatic fitting may turn the dial: whitespace, and a little of
 * the leading, but never the type size. That limit is also what decides
 * whether a last page counts as "largely empty". A few stray lines are
 * absorbed well inside it. A last page with real content on it is not, so
 * it is left alone rather than squeezed without anyone asking.
 */
export const AUTO_FIT_MAX = 1.5;

const lerp = (from: number, to: number, t: number): number => from + (to - from) * Math.min(1, Math.max(0, t));

/**
 * One dial for all four knobs, turned in order of how little each one shows.
 * Whitespace goes first — tighter spacing and margins read as a denser layout,
 * not a smaller one. Then leading. Font size last, because that is the change
 * a reader actually notices. `t` runs 0 (as designed) to `FIT_MAX` (every knob
 * at its floor), and every step along it is at least as tight as the last, so
 * the fewest-pages question can be answered by bisection.
 */
export function fitSettings(t: number): FitSettings {
  return {
    spacing: lerp(1, SPACING_MIN, t),
    margins: lerp(1, MARGINS_MIN, t),
    lineHeight: lerp(1, LINE_HEIGHT_MIN, t - 1),
    fontSize: lerp(1, FONT_SIZE_MIN, t - 2),
  };
}

/**
 * Runs inside the page. The first call snapshots every element's computed
 * sizes, so each later call scales from the design rather than from the last
 * attempt, and works on any template without knowing its selectors. Values are
 * written as inline `!important` styles, which beat anything a template's
 * stylesheet says.
 */
function applyInPage(s: FitSettings): void {
  type Snapshot = { el: HTMLElement; font: number; line: number | null; box: Record<string, number> };
  const w = window as unknown as {
    __fit?: { elements: Snapshot[]; page: Record<string, string>; style: HTMLStyleElement };
  };

  if (!w.__fit) {
    const boxProps = ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'row-gap'];
    const elements: Snapshot[] = [];
    for (const el of [document.body, ...Array.from(document.body.querySelectorAll<HTMLElement>('*'))]) {
      const cs = getComputedStyle(el);
      const box: Record<string, number> = {};
      for (const prop of boxProps) {
        const px = parseFloat(cs.getPropertyValue(prop));
        if (px > 0) box[prop] = px;
      }
      // `normal` leading has no number to scale; it follows the font size.
      const line = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight);
      elements.push({ el, font: parseFloat(cs.fontSize), line, box });
    }

    const page: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSPageRule)) continue;
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const value = rule.style.getPropertyValue(`margin-${side}`);
          if (value) page[side] = value;
        }
      }
    }

    const style = document.createElement('style');
    document.head.appendChild(style);
    w.__fit = { elements, page, style };
  }

  const { elements, page, style } = w.__fit;
  for (const { el, font, line, box } of elements) {
    el.style.setProperty('font-size', `${font * s.fontSize}px`, 'important');
    if (line !== null) {
      el.style.setProperty('line-height', `${line * s.fontSize * s.lineHeight}px`, 'important');
    } else if (s.lineHeight < 1) {
      el.style.setProperty('line-height', `${font * s.fontSize * 1.2 * s.lineHeight}px`, 'important');
    }
    for (const [prop, px] of Object.entries(box)) {
      el.style.setProperty(prop, `${px * s.spacing}px`, 'important');
    }
  }

  // A later @page rule overrides the template's margins and leaves its size alone.
  const margins = Object.entries(page).map(([side, value]) => {
    const m = value.match(/^(-?[\d.]+)([a-z%]*)$/);
    return m ? `margin-${side}: ${parseFloat(m[1]) * s.margins}${m[2]} !important;` : '';
  });
  style.textContent = margins.some(Boolean) ? `@page { ${margins.join(' ')} }` : '';
}

export interface PrintResult {
  pdf: Buffer;
  /** The document as printed — the fitted DOM when fitting changed anything. */
  html: string;
  pages: number;
  /** Pages as the template lays it out, before any fitting. */
  naturalPages: number;
  /** What fitting changed; absent when it already fit, or no budget was asked for. */
  fit?: FitSettings;
  /** Set when even the tightest settings could not reach the page budget. */
  overflow?: boolean;
  /** Set when fitting was automatic — pulling back a nearly empty last page. */
  auto?: boolean;
}

/**
 * Print `html`, and with `pages` set, tighten it just enough to fit that many
 * pages. "Just enough" is the point: bisection finds the smallest turn of the
 * dial that fits, so a resume one line over loses a little whitespace rather
 * than going straight to small type.
 *
 * Without `pages`, `auto` tries to take the last page back — one page fewer,
 * within `AUTO_FIT_MAX` — and prints as designed if that is not enough.
 *
 * When even the floor settings do not fit, the layout is left as designed and
 * `overflow` says so. A crammed two-page resume is worse than an honest one,
 * and the fix at that point is content, which only you can choose.
 */
export async function printPdf(
  html: string,
  opts: { pages?: number; auto?: boolean } = {},
): Promise<PrintResult> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // Chrome only applies print styles under the `print` media type; without
    // this the screen cascade renders and @page is ignored.
    await page.emulateMediaType('print');

    const natural = await print(page);
    const naturalPages = countPdfPages(natural);
    const auto = opts.pages === undefined && opts.auto === true;
    const budget = opts.pages ?? (auto ? naturalPages - 1 : undefined);
    const asDesigned: PrintResult = { pdf: natural, html, pages: naturalPages, naturalPages };
    if (budget === undefined || budget < 1 || naturalPages <= budget) return asDesigned;
    const max = auto ? AUTO_FIT_MAX : FIT_MAX;

    const attempt = async (t: number): Promise<{ pdf: Buffer; pages: number }> => {
      await page.evaluate(applyInPage, fitSettings(t));
      const pdf = await print(page);
      return { pdf, pages: countPdfPages(pdf) };
    };

    if ((await attempt(max)).pages > budget) {
      // Automatically, that just means the last page has real content on it.
      return auto ? asDesigned : { ...asDesigned, overflow: true };
    }

    // Invariant: `hi` fits, `lo` does not. Eight halvings of a range of 3 is
    // a step of about 1% of any one knob — finer than anyone can see.
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if ((await attempt(mid)).pages <= budget) hi = mid;
      else lo = mid;
    }

    const fitted = await attempt(hi);
    return {
      pdf: fitted.pdf,
      html: await page.content(),
      pages: fitted.pages,
      naturalPages,
      fit: fitSettings(hi),
      ...(auto ? { auto } : {}),
    };
  } finally {
    await browser.close();
  }
}

/**
 * One line on what fitting did, for the build output. `budget` is the
 * `--pages` that was asked for; without one, only an automatic fit has
 * anything to report, so the result is `null` when nothing happened.
 */
export function describeFit(result: PrintResult, budget?: number): string | null {
  const plural = (n: number): string => `${n} page${n === 1 ? '' : 's'}`;
  if (budget === undefined && !result.auto) return null;
  if (result.overflow) {
    return (
      `⚠ ${plural(result.naturalPages)} does not fit in ${plural(budget!)} even at the tightest ` +
      'settings — printed as designed; cut some content to get there'
    );
  }
  if (!result.fit) return `fits in ${plural(budget!)} as designed (${plural(result.pages)})`;

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const f = result.fit;
  const changed = [
    pct(f.spacing) !== '100%' && `spacing ${pct(f.spacing)}`,
    pct(f.margins) !== '100%' && `margins ${pct(f.margins)}`,
    pct(f.lineHeight) !== '100%' && `line height ${pct(f.lineHeight)}`,
    pct(f.fontSize) !== '100%' && `font size ${pct(f.fontSize)}`,
  ].filter(Boolean);
  // A spill of a line or two can go with a nudge that rounds to nothing.
  const what = changed.length > 0 ? changed.join(', ') : 'spacing tightened by under 1%';
  if (result.auto) {
    return (
      `pulled a nearly empty page ${result.naturalPages} back: ${plural(result.pages)} with ` +
      `${what} (--no-fit to keep it as designed)`
    );
  }
  return `fitted ${plural(result.naturalPages)} into ${plural(result.pages)}: ${what}`;
}
