import type { Contact, Entry } from '../model/schema.js';

/**
 * The canonical grammar stores dates as whitespace-free tokens (`Jan-2025`), so
 * the hyphen is a stand-in for a space. ISO-ish tokens (`2022-03`) keep theirs.
 */
export function formatDateToken(token: string): string {
  return /[A-Za-z]/.test(token) ? token.replace(/-/g, ' ') : token;
}

/** Import collapses single-date entries to start === end; print those once. */
export function formatDateRange(start: string, end: string): string {
  const from = formatDateToken(start);
  const to = formatDateToken(end);
  return from === to ? from : `${from} – ${to}`;
}

/** Date range plus location, omitting the separator when there is no location. */
export function formatEntryMeta(entry: Entry): string {
  return [formatDateRange(entry.start, entry.end), entry.location].filter(Boolean).join(' · ');
}

export interface ContactChannels {
  /** Address-like details: email, phone, location. */
  primary: string[];
  /** Named hyperlinks. */
  links: Array<{ label: string; url: string }>;
}

export function contactChannels(contact: Contact): ContactChannels {
  return {
    primary: [contact.email, contact.phone, contact.location].filter((v): v is string => !!v),
    links: Object.entries(contact.links ?? {}).map(([label, url]) => ({ label, url })),
  };
}

/**
 * The helper surface a template sees as `it.fmt`. Templates own layout; these
 * exist so every template does not have to reimplement date and contact
 * formatting, and so those rules stay consistent across templates.
 */
export const templateHelpers = {
  dates: (entry: Entry): string => formatDateRange(entry.start, entry.end),
  meta: formatEntryMeta,
  channels: contactChannels,
  upper: (text: string): string => text.toUpperCase(),
  lower: (text: string): string => text.toLowerCase(),
  /** Join the truthy parts with a separator — for contact lines and the like. */
  join: (parts: Array<string | undefined>, separator = ' · '): string =>
    parts.filter(Boolean).join(separator),
};

export type TemplateHelpers = typeof templateHelpers;
