import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Density, Layout, WorkspaceId } from '../lib/types';

export type ToastKind = 'error' | 'info' | 'success';
export interface Toast { id: string; message: string; kind: ToastKind; }

interface UIStore {
  density:        Density;
  layout:         Layout;
  activeWs:       WorkspaceId;
  cmdOpen:        boolean;
  exportOpen:     boolean;
  newSessionOpen: boolean;
  toasts:         Toast[];

  // theme is permanently 'light'
  readonly theme: 'light';

  setDensity:        (d: Density) => void;
  setLayout:         (l: Layout) => void;
  setWorkspace:      (ws: WorkspaceId) => void;
  setCmdOpen:        (v: boolean) => void;
  setExportOpen:     (v: boolean) => void;
  setNewSessionOpen: (v: boolean) => void;
  pushToast:         (message: string, kind?: ToastKind) => void;
  dismissToast:      (id: string) => void;
}

function applyDensity(density: Density) {
  document.documentElement.setAttribute('data-density', density);
}

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    theme:          'light',
    density:        'standard',
    layout:         'standard',
    activeWs:       'acquire',
    cmdOpen:        false,
    exportOpen:     false,
    newSessionOpen: false,
    toasts:         [],

    setDensity: (d) => set((s) => {
      s.density = d;
      applyDensity(d);
    }),

    setLayout:         (l)  => set((s) => { s.layout = l; }),
    setWorkspace:      (ws) => set((s) => { s.activeWs = ws; }),
    setCmdOpen:        (v)  => set((s) => { s.cmdOpen = v; }),
    setExportOpen:     (v)  => set((s) => { s.exportOpen = v; }),
    setNewSessionOpen: (v)  => set((s) => { s.newSessionOpen = v; }),

    pushToast: (message, kind = 'info') => {
      const id = Math.random().toString(36).slice(2);
      set((s) => { s.toasts.push({ id, message, kind }); });
      // Auto-dismiss after 6s
      setTimeout(() => {
        set((s) => { s.toasts = s.toasts.filter(t => t.id !== id); });
      }, 6000);
    },

    dismissToast: (id) => set((s) => { s.toasts = s.toasts.filter(t => t.id !== id); }),
  }))
);

/** Module-level helper so non-React code (stores, ipc) can raise toasts. */
export const toast = (message: string, kind: ToastKind = 'info') =>
  useUIStore.getState().pushToast(message, kind);
