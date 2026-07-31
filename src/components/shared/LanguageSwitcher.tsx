import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/config';

const LABELS: Record<SupportedLanguage, string> = { en: 'EN', fr: 'FR' };

// Two-button toggle rather than a <select> — only 2 languages, so a select's
// extra click (open, then choose) costs more than it saves here.
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language as SupportedLanguage;

  return (
    <div className="flex items-center overflow-hidden rounded border border-slate-200 text-sm">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => i18n.changeLanguage(lang)}
          aria-pressed={current === lang}
          className={`px-2 py-1 font-medium ${
            current === lang ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
