import { useTranslation } from 'react-i18next';
import type { Language } from '@eventseva/app-shared';

/** The app language, for date formatting. */
export function useLang(): Language {
  const { i18n } = useTranslation();
  return i18n.language === 'hi' ? 'hi' : 'en';
}
