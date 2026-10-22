import { useWindowDimensions } from 'react-native';
import { TABLET_WIDTH } from '../lib/theme';

export function useIsTablet(): boolean {
  return useWindowDimensions().width >= TABLET_WIDTH;
}
