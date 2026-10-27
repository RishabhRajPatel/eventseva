// Partner app design tokens. Everything comes from @eventseva/app-shared; only the
// "dark" surfaces (header, splash, login top) use indigo instead of the customer royal blue.
import { colors, radius, space, text, TOUCH } from '@eventseva/app-shared';

export const c = {
  ...colors('partner'),
  /** Borders of unselected chips and inputs: 3.7:1 on white (WCAG 1.4.11 needs 3:1). */
  outline: '#8a78cf',
  /** Text on the status fills (UX.md §1), all at least 4.5:1: */
  onSuccess: '#0b5c36', // on mint 6.6:1, on mintLight 7.4:1
  onWarning: '#7a3e00', // on peach 6.1:1
  onDanger: '#b42318', // on dangerBg 5.6:1
  /** Toast / snackbar surface: white on it is 15:1, lilac 8.8:1. */
  toast: '#23262f',
  /** Dimmed page behind dialogs and sheets. */
  scrim: 'rgba(35,38,47,0.5)',
} as const;
export { radius, space, text, TOUCH };

/** Width from which we use two-pane layouts (tablets, foldables). */
export const TABLET_WIDTH = 600;

/** Opacity of anything disabled (UX.md §2) and of a pressed control. */
export const DISABLED_OPACITY = 0.4;
export const PRESSED_OPACITY = 0.85;
