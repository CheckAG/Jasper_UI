import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Session, Capture, AcqParams } from '../lib/types';
import { ipc } from '../lib/ipc';
import { toast } from './uiStore';

const PALETTE = [
  '#1f5dff','#06b6c4','#6b4ee0','#d97706',
  '#c0322d','#1f9d55','#8b5cf6','#ec4899',
  '#0ea5e9','#f59e0b','#10b981','#ef4444',
];

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// Seed sessions shown on first run (before any user-created sessions exist)
const SEED_SESSIONS: Session[] = [
  { id: 's1', name: 'Maize Leaf — Run 4', device: '', method: 'NIR-Std',  operator: '', createdAt: Date.now() - 3600000,  status: 'active', captureCount: 0 },
  { id: 's2', name: 'Wheat — Run 11',     device: '', method: 'NIR-Std',  operator: '', createdAt: Date.now() - 7200000,  status: 'active', captureCount: 0 },
  { id: 's3', name: 'Soil A — Cal',       device: '', method: 'Soil-Cal', operator: '', createdAt: Date.now() - 86400000, status: 'active', captureCount: 0 },
];

interface SessionStore {
  sessions:    Session[];
  activeId:    string;
  captures:    Capture[];
  selectedIds: string[];                     // captures overlaid on the canvas
  stash:       Record<string, Capture[]>;    // sessionId → cached captures (immer-native)
  hydrated:    boolean;                       // true once SQLite load completes

  activeSession:    () => Session | undefined;
  setActiveSession: (id: string) => Promise<void>;
  addCapture:       (params: AcqParams, xs: Float32Array, ys: Float32Array, tag: string) => void;
  removeCapture:    (id: string) => void;
  toggleSelected:   (id: string) => void;
  clearSelected:    () => void;
  addSession:       (name: string, device: string, method: string, operator?: string) => Session;
  deleteSession:    (id: string) => Promise<void>;
  renameSession:    (id: string, name: string) => void;

  init: () => Promise<void>;   // called once on app start
}

export const useSessionStore = create<SessionStore>()(
  immer((set, get) => ({
    sessions:    SEED_SESSIONS,
    activeId:    's1',
    captures:    [],
    selectedIds: [],
    stash:       {},
    hydrated:    false,

    activeSession: () => get().sessions.find(s => s.id === get().activeId),

    init: async () => {
      try {
        const dbSessions = await ipc.loadSessions();

        if (dbSessions.length === 0) {
          // First run — seed the DB with the sample sessions
          for (const s of SEED_SESSIONS) await ipc.saveSession(s);
          set(s => { s.hydrated = true; });
        } else {
          // Hydrate from DB — counts already come from the SQL subquery
          set(store => {
            store.sessions = dbSessions;
            store.activeId = dbSessions[0]?.id ?? 's1';
            store.hydrated = true;
          });
          // Load captures for the active session
          const activeId = get().activeId;
          const caps = await ipc.loadCaptures(activeId);
          set(s => { s.captures = caps; });
        }
      } catch (e) {
        console.warn('Session init failed (non-Tauri context?):', e);
        set(s => { s.hydrated = true; });
      }
    },

    setActiveSession: async (id) => {
      const prevId = get().activeId;
      if (prevId === id) return;

      set((s) => {
        s.stash[s.activeId] = s.captures;     // cache current
        s.activeId = id;
        s.captures = s.stash[id] ?? [];        // restore cached (or empty)
        s.selectedIds = [];                    // selection is per-session
      });

      // If nothing cached, load from SQLite
      if (get().captures.length === 0) {
        try {
          const caps = await ipc.loadCaptures(id);
          if (caps.length > 0) {
            set(s => {
              s.captures = caps;
              const session = s.sessions.find(x => x.id === id);
              if (session) session.captureCount = caps.length;
            });
          }
        } catch { /* non-Tauri fallback */ }
      }
    },

    addCapture: (params, xs, ys, tag) => {
      const cap: Capture = {
        id:        makeId(),
        sessionId: get().activeId,
        label:     `Capture · #${String(get().captures.length + 1).padStart(2, '0')}`,
        timestamp: Date.now(),
        tag,
        params,
        xs,
        ys,
        color: PALETTE[get().captures.length % PALETTE.length],
      };
      set((s) => {
        s.captures.push(cap);
        const session = s.sessions.find(ss => ss.id === cap.sessionId);
        if (session) session.captureCount += 1;
      });
      // Persist; on failure the capture is only in memory → tell the user
      ipc.saveCapture(cap).catch(e => {
        console.warn('saveCapture:', e);
        toast(`Capture "${cap.label}" was not saved to disk — it exists only in memory.`, 'error');
      });
    },

    removeCapture: (id) => {
      set((s) => {
        s.captures = s.captures.filter(c => c.id !== id);
        s.selectedIds = s.selectedIds.filter(x => x !== id);
      });
      ipc.deleteCapture(id).catch(e => {
        console.warn('deleteCapture:', e);
        toast('Capture removed from view but not from disk.', 'error');
      });
    },

    toggleSelected: (id) => set((s) => {
      s.selectedIds = s.selectedIds.includes(id)
        ? s.selectedIds.filter(x => x !== id)
        : [...s.selectedIds, id];
    }),

    clearSelected: () => set((s) => { s.selectedIds = []; }),

    addSession: (name, device, method, operator = '') => {
      const session: Session = {
        id: makeId(), name, device, method,
        operator, createdAt: Date.now(),
        status: 'active', captureCount: 0,
      };
      set((s) => { s.sessions.unshift(session); });
      ipc.saveSession(session).catch(e => {
        console.warn('saveSession:', e);
        toast(`Session "${session.name}" was not saved to disk.`, 'error');
      });
      return session;
    },

    deleteSession: async (id) => {
      // Pick a fallback to switch to if we're deleting the active session
      const remaining = get().sessions.filter(s => s.id !== id);
      set((s) => {
        s.sessions = s.sessions.filter(x => x.id !== id);
        delete s.stash[id];
        if (s.activeId === id) {
          s.activeId  = remaining[0]?.id ?? '';
          s.captures  = remaining[0] ? (s.stash[remaining[0].id] ?? []) : [];
        }
      });
      try { await ipc.deleteSession(id); }
      catch (e) { console.warn('deleteSession:', e); toast('Failed to delete session from disk.', 'error'); }
      // Load captures for the newly-active session if needed
      const next = get().activeId;
      if (next && get().captures.length === 0) {
        try {
          const caps = await ipc.loadCaptures(next);
          if (caps.length) set(s => { s.captures = caps; });
        } catch { /* non-Tauri */ }
      }
    },

    renameSession: (id, name) => {
      set((s) => {
        const session = s.sessions.find(x => x.id === id);
        if (session) session.name = name;
      });
      const session = get().sessions.find(x => x.id === id);
      if (session) ipc.saveSession(session).catch(e => console.warn('renameSession:', e));
    },
  }))
);
