import { createContext, useContext, type ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fonts, type Language } from '@eventseva/app-shared';
import { c, text } from '../lib/theme';

/** Forces a font set (the login screens are always English). */
const FontLangContext = createContext<Language | null>(null);

export function FontLanguage({ lang, children }: { lang: Language; children: ReactNode }) {
  return <FontLangContext.Provider value={lang}>{children}</FontLangContext.Provider>;
}

/** Lato / Playfair in English, Noto Devanagari in Hindi. */
export function useFonts() {
  const forced = useContext(FontLangContext);
  const { i18n } = useTranslation();
  const lang: Language = forced ?? (i18n.language === 'hi' ? 'hi' : 'en');
  return fonts[lang];
}

export type TextSize = keyof typeof text;
type Variant = 'body' | 'bold' | 'display';

export interface TxtProps extends TextProps {
  variant?: Variant;
  size?: TextSize;
  color?: string;
  align?: TextStyle['textAlign'];
}

export function Txt({ variant = 'body', size = 'md', color = c.text, align, style, ...rest }: TxtProps) {
  const f = useFonts();
  const fontFamily = variant === 'display' ? f.display : variant === 'bold' ? f.bodyBold : f.body;
  return <Text {...rest} style={[{ fontFamily, fontSize: text[size], color, textAlign: align }, style]} />;
}
