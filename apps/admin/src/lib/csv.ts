// CSV downloads: the request path and the file name the API sends.
import { toQueryString } from './labels.ts';
import type { ExportKind } from './roles.ts';

/** Same-origin path (rewritten to the API), with optional inclusive India dates. */
export function exportUrl(kind: ExportKind, from?: string, to?: string): string {
  return `/api/v1/admin/export/${kind}${toQueryString({ from, to })}`;
}

/**
 * File name from a Content-Disposition header: filename*=UTF-8''… wins over filename="…".
 * Path parts are stripped, so a header can never pick a folder.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:[\w-]+'[\w-]*')?("?)([^";]+)\1/i.exec(header);
  if (star) {
    try {
      name = decodeURIComponent(star[2]);
    } catch {
      name = star[2];
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
    name = plain ? (plain[1] ?? plain[2]).replace(/\\(.)/g, '$1').trim() : null;
  }
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base ? base : fallback;
}

/** null when the range is fine. Dates are 'YYYY-MM-DD' strings from date inputs. */
export function checkRange(from: string, to: string): string | null {
  if (from && to && from > to) return 'The “from” date must be before the “to” date.';
  return null;
}
