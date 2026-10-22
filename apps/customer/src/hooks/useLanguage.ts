import { useTranslation } from 'react-i18next';
import type { Language } from '@eventseva/app-shared';
import { fonts } from '../lib/theme';

/** The current app language and its font set (Noto Devanagari for Hindi, Lato/Playfair for English). */
export function useLanguage() {
  const { i18n } = useTranslation();
  const lang: Language = i18n.language === 'hi' ? 'hi' : 'en';
  return { lang, fonts: fonts[lang] };
}
