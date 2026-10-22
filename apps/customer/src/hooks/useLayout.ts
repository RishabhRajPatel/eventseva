import { useWindowDimensions } from 'react-native';
import { RAIL_MIN_WIDTH, TABLET_MIN_WIDTH } from '../lib/theme';

/** Phone: 2 columns. Tablet: 3 (portrait) or 4 (landscape) columns, side rail when wide. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const hasRail = width >= RAIL_MIN_WIDTH;
  return {
    width,
    height,
    isTablet,
    hasRail,
    gridColumns: !isTablet ? 2 : hasRail ? 4 : 3,
    /** Side padding: 20dp on phones (1.25rem), 32dp on tablets. */
    gutter: isTablet ? 32 : 20,
  };
}
