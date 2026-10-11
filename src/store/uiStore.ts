import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Density, Layout, WorkspaceId } from '../lib/types';
import { DEFAULT_WORKSPACE } from '../lib/features';

export type Theme = 'light' | 'dark';
/** Dialogs opened from the menu bar. One at a time. */
export type DialogId = 'instruments' | 'firmware' | 'diagnostics' | 'xcal' | 'shortcuts';
export type ToastKind = 'error' | 'info' | 'success';
export interface Toast { id: string; message: string; kind: ToastKind; }

interface UIStore {
  density:        Density;
  layout:         Layout;
  activeWs:       WorkspaceId;
  cmdOpen:        boolean;
  exportOpen:     boolean;
  newSessionOpen: boolean;
  dialog:         DialogId | null;
  toasts:         Toast[];

  theme:          Theme;

  setTheme:          (t: Theme) => void;
  setDensity:        (d: Density) => void;
  setLayout:         (l: Layout) => void;
  setWorkspace:      (ws: WorkspaceId) => void;
  setCmdOpen:        (v: boolean) => void;
  setExportOpen:     (v: boolean) => void;
  setNewSessionOpen: (v: boolean) => void;
  setDialog:         (d: DialogId | null) => void;
  pushToast:         (message: string, kind?: ToastKind) => void;
  dismissToast:      (id: string) => void;
}

function applyDensity(density: Density) {
  document.documentElement.setAttribute('data-density', density);
}

const THEME_KEY = 'jasper.theme';

/** The theme is a per-machine display preference, so localStorage is enough. */
function storedTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    theme:          storedTheme(),
    density:        'standard',
    layout:         'standard',
    activeWs:       DEFAULT_WORKSPACE,
    cmdOpen:        false,
    exportOpen:     false,
    newSessionOpen: false,
    dialog:         null,
    toasts:         [],

    setTheme: (t) => set((s) => {
      s.theme = t;
      applyTheme(t);
      try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: still applies */ }
    }),

    setDensity: (d) => set((s) => {
      s.density = d;
      applyDensity(d);
    }),

    setLayout:         (l)  => set((s) => { s.layout = l; }),
    setWorkspace:      (ws) => set((s) => { s.activeWs = ws; }),
    setCmdOpen:        (v)  => set((s) => { s.cmdOpen = v; }),
    setExportOpen:     (v)  => set((s) => { s.exportOpen = v; }),
    setNewSessionOpen: (v)  => set((s) => { s.newSessionOpen = v; }),
    setDialog:         (d)  => set((s) => { s.dialog = d; }),

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
