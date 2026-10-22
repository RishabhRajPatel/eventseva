// Partner app design tokens. Everything comes from @eventseva/app-shared; only the
// "dark" surfaces (header, splash, login top) use indigo instead of the customer royal blue.
import { colors, radius, space, text, TOUCH } from '@eventseva/app-shared';

export const c = colors('partner');
export { radius, space, text, TOUCH };

/** Width from which we use two-pane layouts (tablets, foldables). */
export const TABLET_WIDTH = 600;
