/**
 * daily — quick capture, daily notes and templates.
 *
 * The "second brain" apps (Obsidian, Logseq, AnyType) all lead with the same three entry points:
 * capture a thought now, land in a dated note, start from a template. Wrytrove implements them as
 * ordinary Markdown files inside a folder you picked, so nothing is locked in a database and the
 * whole feature works when the folder is a Dropbox or OneDrive directory.
 *
 * Pure functions only: filename policy, template expansion and the capture snippet are tested
 * without touching the filesystem.
 */

export const CAPTURE_HEADING = '## Captured';
export const MAX_TEMPLATE_CHARS = 50_000;
export const MAX_CAPTURE_CHARS = 20_000;

export const DEFAULT_DAILY_TEMPLATE = [
  '# {{title}}',
  '',
  '- [ ] Review yesterday',
  '- [ ] Top three things',
  '',
  '## Notes',
  '',
].join('\n');

export const DEFAULT_CAPTURE_SUFFIX = 'Inbox.md';
export const DEFAULT_CAPTURE_SNIPPET = [
  '## Captured',
  '',
  '- {{time}} — ',
  '',
].join('\n');

export interface DailyOptions {
  /** `yyyy-mm-dd` (default), `yyyy-MM`, `yyyy/MM/dd`, `dd-MM-yyyy`. */
  format: DailyFormat;
  template: string;
  /** Folder-relative path, e.g. `Daily` or empty for the root. */
  folder: string;
}

export type DailyFormat = 'yyyy-mm-dd' | 'yyyy-mm' | 'yyyy/MM/dd' | 'dd-MM-yyyy' | 'yyyy-MM-dd';

export const DAILY_FORMATS: { id: DailyFormat; label: string; example: (date: Date) => string }[] = [
  { id: 'yyyy-mm-dd', label: '2026-11-13', example: (d) => isoDate(d) },
  { id: 'yyyy/MM/dd', label: '2026/11/13 (folders)', example: (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` },
  { id: 'dd-MM-yyyy', label: '13-11-2026', example: (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` },
  { id: 'yyyy-mm', label: '2026-11 (monthly)', example: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}` },
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function humanDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** The folder-relative path (no extension) for a daily note. Always safe on Windows. */
export function dailyNotePath(format: DailyFormat, date: Date, folder = ''): string {
  const base = format === 'yyyy/MM/dd'
    ? `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
    : format === 'dd-MM-yyyy'
      ? `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
      : format === 'yyyy-mm'
        ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
        : isoDate(date);
  const clean = folder.trim().replace(/^[\\/]+|[\\/]+$/gu, '').replace(/\\/gu, '/');
  if (!clean) return base;
  if (!isSafeRelativePath(clean)) throw new Error('Choose a folder name without special characters.');
  return `${clean}/${base}`;
}

/** Reject `..`, drive letters, control characters and reserved Windows names, segment by segment. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 240) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0
    && segment !== '.' && segment !== '..'
    && !/[<>:"|?*\u0000-\u001f]/u.test(segment)
    && !/[ .]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(segment));
}

/** Expand `{{date}}`, `{{time}}`, `{{title}}`, `{{weekday}}` and `{{iso}}` in a template. */
export function expandDailyTemplate(template: string, date: Date, title: string): string {
  return template
    .slice(0, MAX_TEMPLATE_CHARS)
    .replace(/\{\{\s*date\s*\}\}/giu, isoDate(date))
    .replace(/\{\{\s*time\s*\}\}/giu, isoTime(date))
    .replace(/\{\{\s*title\s*\}\}/giu, title)
    .replace(/\{\{\s*weekday\s*\}\}/giu, date.toLocaleDateString(undefined, { weekday: 'long' }))
    .replace(/\{\{\s*iso\s*\}\}/giu, date.toISOString());
}
