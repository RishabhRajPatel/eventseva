// Line icons copied from the design boards (24×24 viewBox, round caps), drawn with react-native-svg.
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { c } from '../lib/theme';

const ICONS = {
  back: <Path d="M15 5l-7 7 7 7" />,
  next: <Path d="M9 5l7 7-7 7" />,
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  dashboard: (
    <>
      <Rect x="3" y="3" width="7" height="9" rx="1.5" />
      <Rect x="14" y="3" width="7" height="5" rx="1.5" />
      <Rect x="14" y="12" width="7" height="9" rx="1.5" />
      <Rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  bookings: <Path d="M9 4h6v3H9zM6 6h12v15H6z" />,
  calendar: (
    <>
      <Rect x="4" y="5" width="16" height="15" rx="2" />
      <Path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  chat: <Path d="M4 5h16v11H8l-4 4z" />,
  profile: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
    </>
  ),
  check: <Path d="M5 12l4 4 10-10" />,
  upload: <Path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  phone: <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  send: <Path d="M4 12l16-8-6 16-2-6z" />,
  eye: (
    <>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  wifiOff: (
    <>
      <Path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" />
      <Circle cx="12" cy="19" r="1" />
      <Path d="M3 3l18 18" />
    </>
  ),
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-3.5-3.5M8.5 11h5" />
    </>
  ),
  star: <Path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />,
  alert: (
    <>
      <Path d="M12 3l10 18H2z" />
      <Path d="M12 10v5M12 18v.01" />
    </>
  ),
  trash: <Path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />,
  image: (
    <>
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Circle cx="9" cy="10" r="2" />
      <Path d="M21 16l-5-5-9 9" />
    </>
  ),
  bank: <Path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" />,
  rupee: <Path d="M7 4h11M7 9h11M7 4h3a5 5 0 0 1 0 10H7l8 7" />,
  help: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17v.01" />
    </>
  ),
  globe: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  logout: <Path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  edit: <Path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  // Service categories (by slug); the first ones are from the home board.
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
  catering: <Path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6M10 6h4" />,
  hotel: <Path d="M3 19V6M3 15h18v4M21 15v-2a3 3 0 0 0-3-3h-7v5M7 12.5a1.5 1.5 0 1 0 0-.01" />,
  bartender: <Path d="M6 4h12l-6 8zM12 12v8M8 20h8" />,
  makeup: <Path d="M9 21h6v-9H9zM10 12V7l4-3v8" />,
  other: (
    <>
      <Circle cx="5" cy="12" r="1.5" />
      <Circle cx="12" cy="12" r="1.5" />
      <Circle cx="19" cy="12" r="1.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = c.text, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </Svg>
  );
}

const CATEGORY_SLUGS = ['hall', 'dj', 'camera', 'halwai', 'catering', 'band', 'car', 'decor', 'hotel', 'bartender', 'makeup', 'other'] as const;

export function CategoryIcon({ slug, size = 24, color = c.royal }: { slug: string; size?: number; color?: string }) {
  const name: IconName = (CATEGORY_SLUGS as readonly string[]).includes(slug) ? (slug as IconName) : 'other';
  return <Icon name={name} size={size} color={color} strokeWidth={1.8} />;
}
