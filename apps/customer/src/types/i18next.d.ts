// Typed translation keys: a t('…') call with a key missing from en.json fails the type check.
import 'i18next';
import type en from '../i18n/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    returnNull: false;
  }
}
