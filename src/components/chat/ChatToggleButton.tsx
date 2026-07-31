import { useTranslation } from 'react-i18next';

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.9 5.2 5.2 1.9-5.2 1.9L12 17.7l-1.9-6.2-5.2-1.9 5.2-1.9L12 2.5zM19 14.5l.95 2.6 2.6.95-2.6.95-.95 2.6-.95-2.6-2.6-.95 2.6-.95.95-2.6z" />
    </svg>
  );
}

interface ChatToggleButtonProps {
  open: boolean;
  onToggle: () => void;
}

// Header button that opens/closes ChatPanel.tsx — same visual treatment as
// FiltersToggle.tsx (border/bg flips when active) for consistency with the
// header's other toggle-a-panel controls.
export function ChatToggleButton({ open, onToggle }: ChatToggleButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onToggle}
      title={t('chat.toggle')}
      aria-pressed={open}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm ${
        open ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <SparkleIcon />
      {t('chat.toggle')}
    </button>
  );
}
