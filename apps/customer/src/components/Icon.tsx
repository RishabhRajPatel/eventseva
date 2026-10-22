// Line icons copied from the design boards (24×24, round caps). Category icons by slug at the end.
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { c } from '../lib/theme';

const paths = {
  back: <Path d="M15 5l-7 7 7 7" />,
  forward: <Path d="M9 5l7 7-7 7" />,
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-3.5-3.5" />
    </>
  ),
  searchEmpty: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-3.5-3.5M8.5 11h5" />
    </>
  ),
  pin: (
    <>
      <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <Circle cx="12" cy="10" r="2.5" />
    </>
  ),
  heart: <Path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  chat: <Path d="M4 5h16v11H8l-4 4z" />,
  chatCheck: (
    <>
      <Path d="M4 5h16v11H8l-4 4z" />
      <Path d="M9 10.5l2 2 4-4" />
    </>
  ),
  phone: <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  home: <Path d="M3 11l9-7 9 7v9H3z" />,
  calendar: (
    <>
      <Rect x="4" y="5" width="16" height="15" rx="2" />
      <Path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  user: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
    </>
  ),
  send: <Path d="M4 12l16-8-6 16-2-6z" />,
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  check: <Path d="M5 12l4 4 10-10" />,
  checkCircle: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8 12l3 3 5-6" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  wifiOff: (
    <>
      <Path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" />
      <Circle cx="12" cy="19" r="1" />
      <Path d="M3 3l18 18" />
    </>
  ),
  star: <Path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <Circle cx="5" cy="12" r="1.5" />
      <Circle cx="12" cy="12" r="1.5" />
      <Circle cx="19" cy="12" r="1.5" />
    </>
  ),
  help: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </>
  ),
  alert: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v6M12 16.5h.01" />
    </>
  ),
  // ---- categories (hall … decor from the Home board; the rest drawn in the same style) ----
  hall: <Path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />,
  dj: (
    <>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx="6" cy="18" r="3" />
      <Circle cx="18" cy="16" r="3" />
    </>
  ),
  camera: (
    <>
      <Path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <Circle cx="12" cy="13" r="3.5" />
    </>
  ),
  halwai: <Path d="M3 12h18a9 9 0 0 1-18 0zM8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4" />,
  catering: <Path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6M10 6h4" />,
  band: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Circle cx="12" cy="12" r="3" />
      <Path d="M4 12h5M15 12h5" />
    </>
  ),
  car: (
    <>
      <Path d="M3 16v-4l2-5h14l2 5v4H3z" />
      <Circle cx="7" cy="17" r="2" />
      <Circle cx="17" cy="17" r="2" />
    </>
  ),
  decor: <Path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />,
  hotel: (
    <>
      <Path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" />
      <Circle cx="7" cy="11.5" r="1.8" />
    </>
  ),
  bartender: <Path d="M6 3h12l-1.5 8a4.5 4.5 0 0 1-9 0zM12 15.5V21M8 21h8M7 7h10" />,
  makeup: <Path d="M9 21h6M10 21v-9h4v9M10.5 12V6.5L13.5 4v8" />,
  other: <Path d="M12 3c2 3 3 4.5 3 6.5a3 3 0 0 1-6 0C9 7.5 10 6 12 3zM4 15h16l-2 5H6z" />,
} as const;

export type IconName = keyof typeof paths;

const CATEGORY_SLUGS = ['hall', 'dj', 'camera', 'halwai', 'catering', 'band', 'car', 'decor', 'hotel', 'bartender', 'makeup', 'other'] as const;

/** Unknown slugs fall back to the "other" icon. */
export const categoryIcon = (slug: string): IconName =>
  (CATEGORY_SLUGS as readonly string[]).includes(slug) ? (slug as IconName) : 'other';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}

export function Icon({ name, size = 20, color = c.text, strokeWidth = 2, fill = 'none' }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {paths[name]}
    </Svg>
  );
}
