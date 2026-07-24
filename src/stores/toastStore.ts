import { create } from 'zustand';

export interface ToastState {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastStoreState {
  toast: ToastState | null;
  show: (toast: Omit<ToastState, 'id'>) => void;
  dismiss: (id: string) => void;
}

// Generic notification mechanism — nothing here is undo-specific, only the
// content historyStore.ts pushes into it is. In-memory only, like
// selectionStore.ts (a toast has no reason to survive a reload).
export const useToastStore = create<ToastStoreState>((set, get) => ({
  toast: null,
  show: (toast) => {
    set({ toast: { ...toast, id: crypto.randomUUID() } });
  },
  dismiss: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
}));
