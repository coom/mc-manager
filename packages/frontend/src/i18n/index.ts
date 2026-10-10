import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import fr from './locales/fr.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const;

export const SUPPORTED_LANGUAGES = LANGUAGES.map((l) => l.code);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true, // map fr-FR → fr, etc.
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'mc_lang',
      caches: ['localStorage'],
    },
  });

/** Change language and persist it to localStorage (account sync done by callers). */
export function setLanguage(code: string): void {
  i18n.changeLanguage(code);
  try { localStorage.setItem('mc_lang', code); } catch { /* ignore */ }
}

export default i18n;
