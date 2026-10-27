// The admin palette, mirrored from the :root variables in app/globals.css (a test keeps them equal),
// and every foreground / background pair the panel uses, with the WCAG minimum it must meet.
import { AA_TEXT, AA_UI } from './contrast.ts';

export const PALETTE = {
  royal: '#263baa',
  ink: '#23262f',
  cream: '#fff4d6',
  lavender: '#e8deff',
  lilac: '#d9b8ff',
  peach: '#ffd6a5',
  mint: '#b7f7d4',
  'mint-light': '#ddfbef',
  white: '#ffffff',
  muted: '#4a4e5c',
  /** Borders of inputs, unselected chips and cards that must be seen (3:1 on white and cream). */
  line: '#8a7bb8',
  danger: '#b42318',
  'danger-bg': '#fde8e7',
  /** Status text on mint (UX.md §1). */
  'success-ink': '#0b5c36',
  /** Status text on peach (UX.md §1), also the warning bar outline. */
  'warning-ink': '#7a3e00',
  'warning-bg': '#fff6e8',
  'row-hover': '#f7f3ff',
  'row-selected': '#efe7ff',
} as const;

export type PaletteName = keyof typeof PALETTE;

export interface ColourPair {
  fg: PaletteName;
  bg: PaletteName;
  /** Where the pair is used. */
  use: string;
  min: number;
}

export const CONTRAST_PAIRS: ColourPair[] = [
  { fg: 'ink', bg: 'cream', use: 'body text on the page', min: AA_TEXT },
  { fg: 'ink', bg: 'white', use: 'text in cards and tables', min: AA_TEXT },
  { fg: 'muted', bg: 'cream', use: 'secondary text on the page', min: AA_TEXT },
  { fg: 'muted', bg: 'white', use: 'hints and table sub-lines', min: AA_TEXT },
  { fg: 'muted', bg: 'row-hover', use: 'sub-lines in a hovered row', min: AA_TEXT },
  { fg: 'muted', bg: 'row-selected', use: 'sub-lines in a selected row', min: AA_TEXT },
  { fg: 'royal', bg: 'white', use: 'links and outline buttons', min: AA_TEXT },
  { fg: 'royal', bg: 'cream', use: 'links on the page', min: AA_TEXT },
  { fg: 'royal', bg: 'lavender', use: 'table headers, info pills, role badge', min: AA_TEXT },
  { fg: 'royal', bg: 'peach', use: 'stat values on attention cards', min: AA_TEXT },
  { fg: 'white', bg: 'royal', use: 'primary buttons, current tab', min: AA_TEXT },
  { fg: 'white', bg: 'danger', use: 'destructive buttons, error toast', min: AA_TEXT },
  { fg: 'white', bg: 'ink', use: 'sidebar links, dark pills', min: AA_TEXT },
  { fg: 'ink', bg: 'lilac', use: 'selected chips', min: AA_TEXT },
  { fg: 'ink', bg: 'mint', use: 'success toast', min: AA_TEXT },
  { fg: 'ink', bg: 'peach', use: 'sidebar count badge', min: AA_TEXT },
  { fg: 'success-ink', bg: 'mint', use: 'success pills', min: AA_TEXT },
  { fg: 'success-ink', bg: 'mint-light', use: 'soft success pills', min: AA_TEXT },
  { fg: 'warning-ink', bg: 'peach', use: 'waiting / warning pills', min: AA_TEXT },
  { fg: 'warning-ink', bg: 'warning-bg', use: 'warning notes and alerts', min: AA_TEXT },
  { fg: 'danger', bg: 'danger-bg', use: 'error pills, inline errors, red alerts', min: AA_TEXT },
  { fg: 'danger', bg: 'white', use: 'field errors, red outline buttons', min: AA_TEXT },
  { fg: 'line', bg: 'white', use: 'input, select and chip borders', min: AA_UI },
  { fg: 'line', bg: 'cream', use: 'borders on the page background', min: AA_UI },
  { fg: 'royal', bg: 'white', use: 'focus ring, selected borders', min: AA_UI },
  { fg: 'warning-ink', bg: 'white', use: 'outline of the peach SMS bar', min: AA_UI },
  { fg: 'danger', bg: 'lavender', use: 'red SMS bar on its track', min: AA_UI },
  { fg: 'royal', bg: 'lavender', use: 'normal SMS bar on its track', min: AA_UI },
];

/** Pairs the panel must never use: white text on the pastel status fills is unreadable. */
export const FORBIDDEN_PAIRS: Array<{ fg: PaletteName; bg: PaletteName }> = [
  { fg: 'white', bg: 'mint' },
  { fg: 'white', bg: 'peach' },
  { fg: 'white', bg: 'lilac' },
];
