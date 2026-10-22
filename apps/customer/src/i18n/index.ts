// App text in English (default) and Hindi. Hindi is chosen only from Profile → Language.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@eventseva/app-shared';
import en from './en.json';
import hi from './hi.json';

export const resources = { en: { translation: en }, hi: { translation: hi } } as const;

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const currentLanguage = (): Language => (i18n.language === 'hi' ? 'hi' : 'en');

export async function setLanguage(lang: Language) {
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

export default i18n;
