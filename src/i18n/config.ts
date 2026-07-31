import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Bilingual EN/FR (2026-07-30, backlog item 45) — English is the default for
// every fresh browser; a user's own pick is persisted to localStorage and
// wins on every later visit. No browser-language auto-detection: the org is
// Havas International and a predictable default matters more here than
// guessing from Accept-Language.
const STORAGE_KEY = 'orgchart-language';
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

function readStoredLanguage(): SupportedLanguage {
  // Guards against environments with no `localStorage` (Vitest's node test
  // environment has none — see vitest.config.ts, no jsdom) rather than
  // crashing every test that transitively imports historyStore.ts, which
  // imports this module for the toast/history label translations.
  if (typeof localStorage === 'undefined') return DEFAULT_LANGUAGE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage) ? (stored as SupportedLanguage) : DEFAULT_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lng);
});

export default i18n;
