import { useEffect } from 'react';
import { useToastStore } from '../../stores/toastStore';

const AUTO_DISMISS_MS = 5000;

export function Toast() {
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div
      data-row-stabilizer-ignore
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-lg"
    >
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          onClick={() => {
            toast.onAction?.();
            dismiss(toast.id);
          }}
          className="font-medium text-slate-900 hover:underline"
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        onClick={() => dismiss(toast.id)}
        className="text-slate-400 hover:text-slate-600"
        title="Fermer"
      >
        ✕
      </button>
    </div>
  );
}
