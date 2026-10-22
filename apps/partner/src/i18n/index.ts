import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@eventseva/app-shared';
import en from './en.json';
import hi from './hi.json';

export const resources = { en: { translation: en }, hi: { translation: hi } } as const;

// English by default; Hindi only when the vendor picks it (Profile → Language) or it is
// their saved choice on the server.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
});

export const currentLanguage = (): Language => (i18n.language === 'hi' ? 'hi' : 'en');

export async function applyLanguage(lang: Language) {
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

/** For the login screens, which are always in English. */
export const englishT = i18n.getFixedT('en');

export default i18n;
