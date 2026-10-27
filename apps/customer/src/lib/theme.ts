import { colors, fonts, radius, space, text, TOUCH } from '@eventseva/app-shared';

/**
 * Customer palette: royal blue header and buttons on cream, plus the status text colours from
 * docs/UX.md §1 (each pair passes WCAG AA on its fill).
 */
export const c = {
  ...colors('customer'),
  /** Text and icons on mint / mintLight (6.6:1 on mint). */
  successText: '#0b5c36',
  /** Text and icons on peach (6.1:1). */
  warningText: '#7a3e00',
  /** Input borders: lilac family, 3.7:1 on white and 3.4:1 on cream (WCAG 1.4.11). */
  outline: '#8a78cf',
  /** Selected chips, tiles, slots and dates: lilac fill, 2dp royal border and a ✓ (UX.md §2). */
  selectedBg: '#d9b8ff',
  selectedBorder: '#263baa',
};
export { fonts, radius, space, text, TOUCH };

/** Tablet layouts from TabletHome / TabletSearch start at 600dp; the side rail from 900dp. */
export const TABLET_MIN_WIDTH = 600;
export const RAIL_MIN_WIDTH = 900;
