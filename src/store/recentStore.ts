import { create } from 'zustand';
import type { Recent, Session } from '../lib/types';
import { ipc } from '../lib/ipc';

const MAX_EXPORTS = 10;

interface RecentStore extends Recent {
  /** Read recent.json. Called by sessionStore.init before it picks a workspace. */
  load: () => Promise<void>;
  markOpened: (sessionId: string) => void;
  addExport: (path: string) => void;
}

/** Recent workspaces and exports, kept in recent.json by the backend. */
export const useRecentStore = create<RecentStore>()((set, get) => {
  const save = () => {
    const { opened, exports } = get();
    ipc.saveRecent({ opened, exports }).catch(e => console.warn('recent.json:', e));
  };
  return {
    opened:  {},
    exports: [],
    load: async () => {
      try {
        const r = await ipc.loadRecent();
        if (r) set({ opened: r.opened ?? {}, exports: r.exports ?? [] });
      } catch (e) { console.warn('recent.json:', e); }
    },
    markOpened: (id) => { set(s => ({ opened: { ...s.opened, [id]: Date.now() } })); save(); },
    addExport: (path) => {
      set(s => ({ exports: [{ path, at: Date.now() }, ...s.exports.filter(e => e.path !== path)].slice(0, MAX_EXPORTS) }));
      save();
    },
  };
});

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 60 / 24)} d ago`;
}

/** Workspaces, last opened first; never-opened ones after, newest created first. */
export function byRecent(sessions: Session[], opened: Record<string, number>): Session[] {
  return [...sessions].sort((a, b) => (opened[b.id] ?? 0) - (opened[a.id] ?? 0) || b.createdAt - a.createdAt);
}
