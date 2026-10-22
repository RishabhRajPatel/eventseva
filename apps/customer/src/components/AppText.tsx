import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import type { Language } from '@eventseva/app-shared';
import { useLanguage } from '../hooks/useLanguage';
import { c, fonts, text } from '../lib/theme';

export interface AppTextProps extends TextProps {
  /** body = Lato regular, bold = Lato bold, display = Playfair (headings only). */
  variant?: 'body' | 'bold' | 'display';
  size?: keyof typeof text | number;
  color?: string;
  align?: TextStyle['textAlign'];
  /** Force a script, e.g. "हिंदी" on an English screen needs the Devanagari font. */
  lang?: Language;
}

/** Every piece of text goes through here so the font follows the app language. */
export function AppText({ variant = 'body', size = 'md', color = c.text, align, lang, style, ...rest }: AppTextProps) {
  const current = useLanguage();
  const set = fonts[lang ?? current.lang];
  const fontSize = typeof size === 'number' ? size : text[size];
  const isHindi = (lang ?? current.lang) === 'hi';
  const fontFamily = variant === 'display' ? set.display : variant === 'bold' ? set.bodyBold : set.body;
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[
        styles.base,
        // Devanagari has taller marks above and below the line, so it needs more line height.
        { fontFamily, fontSize, color, lineHeight: Math.round(fontSize * (isHindi ? 1.6 : 1.35)), textAlign: align },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ base: { includeFontPadding: false } });
