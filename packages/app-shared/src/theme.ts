// Design tokens from the design boards (design/*.dc.html). Both apps use the same palette;
// the Partner app swaps only the dark "ink" surfaces for indigo.

export const palette = {
  royal: '#263baa', // primary: buttons, links, customer header
  ink: '#23262f', // body text
  indigo: '#312e81', // Partner app: header and dark surfaces
  cream: '#fff4d6', // page background
  lavender: '#e8deff', // cards, chips
  lilac: '#d9b8ff', // selected chip, accents
  peach: '#ffd6a5', // warnings, "waiting" states
  mint: '#b7f7d4', // success, "confirmed"
  mintLight: '#ddfbef', // success backgrounds
  white: '#ffffff',
  muted: '#4a4e5c', // secondary text (passes contrast on cream and white)
} as const;

export type AppFlavor = 'customer' | 'partner';

export function colors(app: AppFlavor) {
  return {
    ...palette,
    primary: palette.royal,
    onPrimary: palette.white,
    background: palette.cream,
    surface: palette.white,
    text: palette.ink,
    textMuted: palette.muted,
    header: app === 'partner' ? palette.indigo : palette.royal,
    onHeader: palette.white,
    border: palette.lavender,
    success: palette.mint,
    successBg: palette.mintLight,
    warning: palette.peach,
    danger: '#b42318',
    dangerBg: '#fde8e7',
  };
}

export type Colors = ReturnType<typeof colors>;

/** Lato for text, Playfair Display for the wordmark and headings; Noto Devanagari when Hindi is on. */
export const fonts = {
  en: { body: 'Lato_400Regular', bodyBold: 'Lato_700Bold', display: 'PlayfairDisplay_700Bold' },
  hi: { body: 'NotoSansDevanagari_400Regular', bodyBold: 'NotoSansDevanagari_700Bold', display: 'NotoSerifDevanagari_700Bold' },
} as const;

/** dp (React Native density-independent pixels). 1rem on the boards = 16dp. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
/** Font sizes in sp (scale with the phone's font setting). */
export const text = { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, display: 28 } as const;
/** Minimum touch target (Android guideline). */
export const TOUCH = 48;
