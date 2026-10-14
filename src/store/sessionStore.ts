import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Session, Capture } from '../lib/types';
import { ipc } from '../lib/ipc';
import { toast } from './uiStore';
import { useRecentStore } from './recentStore';

const PALETTE = [
  '#1f5dff','#06b6c4','#6b4ee0','#d97706',
  '#c0322d','#1f9d55','#8b5cf6','#ec4899',
  '#0ea5e9','#f59e0b','#10b981','#ef4444',
];

/** Captures saved without a colour (from a script) get one by position. */
function withColors(caps: Capture[]): Capture[] {
  return caps.map((c, i) => c.color ? c : { ...c, color: PALETTE[i % PALETTE.length] });
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// Seed sessions shown on first run (before any user-created sessions exist)
interface SessionStore {
  sessions:    Session[];
  /** null until a session exists — the app no longer ships seeded ones. */
  activeId:    string | null;
  captures:    Capture[];
  selectedIds: string[];                     // captures overlaid on the canvas
  stash:       Record<string, Capture[]>;    // sessionId → cached captures (immer-native)
  hydrated:    boolean;                       // true once SQLite load completes

  activeSession:    () => Session | undefined;
  setActiveSession: (id: string) => Promise<void>;
  /** id and colour for the next capture in the active workspace (the backend names it). */
  nextCapture:      () => { id: string; color: string };
  /** Show a capture the backend has saved. */
  addSavedCapture:  (cap: Capture) => void;
  /** Pick up captures filed by another caller (a script, the CLI, an agent). */
  syncCaptures:     (sessionId: string) => Promise<void>;
  removeCapture:    (id: string) => void;
  toggleSelected:   (id: string) => void;
  clearSelected:    () => void;
  addSession:       (name: string, device: string, method: string, operator?: string) => Session;
  deleteSession:    (id: string) => Promise<void>;
  renameSession:    (id: string, name: string) => void;

  init: () => Promise<void>;   // called once on app start
}

/** Name of the session created when the database is empty. Deliberately plain:
 *  it describes nothing about the sample, because nothing has been measured. */
const DEFAULT_SESSION_NAME = 'Default session';

/** init() creates a session when the database is empty, so it must not run
 *  twice. React invokes mount effects twice in development, and `hydrated` is
 *  only set at the end — both calls saw an empty database and each made a
 *  session. Guarding on entry rather than on completion. */
let initStarted = false;

export const useSessionStore = create<SessionStore>()(
  immer((set, get) => ({
    sessions:    [],
    activeId:    null,
    captures:    [],
    selectedIds: [],
    stash:       {},
    hydrated:    false,

    activeSession: () => get().sessions.find(s => s.id === get().activeId),

    init: async () => {
      if (initStarted) return;
      initStarted = true;
      try {
        const [dbSessions] = await Promise.all([ipc.loadSessions(), useRecentStore.getState().load()]);

        // Startup lands on the workspace used last (recent.json), else the
        // default session — the first row SQLite hands back is not a meaningful choice.
        // ponytail: default matched by name; a renamed default makes a second one.
        // Key it on a column if that turns out to matter.
        set(store => {
          store.sessions = dbSessions;
          store.hydrated = true;
        });

        // No default in the database (first run, or it was deleted) — there has
        // to be somewhere to put a capture, so one empty session is created.
        // It holds no data; it is just a place to start.
        // The workspace used last, if it still exists; else the default.
        const opened = useRecentStore.getState().opened;
        const last = dbSessions.filter(s => opened[s.id]).sort((a, b) => opened[b.id] - opened[a.id])[0];
        const activeId = last?.id
          ?? dbSessions.find(s => s.name === DEFAULT_SESSION_NAME)?.id
          ?? get().addSession(DEFAULT_SESSION_NAME, '', '').id;
        set(s => { s.activeId = activeId; });

        const caps = withColors(await ipc.loadCaptures(activeId));
        if (caps.length) set(s => { s.captures = caps; });
      } catch (e) {
        console.warn('Session init failed (non-Tauri context?):', e);
        set(s => { s.hydrated = true; });
      }
    },

    setActiveSession: async (id) => {
      const prevId = get().activeId;
      if (prevId === id) return;

      set((s) => {
        if (s.activeId) s.stash[s.activeId] = s.captures;   // cache current
        s.activeId = id;
        s.captures = s.stash[id] ?? [];        // restore cached (or empty)
        s.selectedIds = [];                    // selection is per-session
      });

      // If nothing cached, load from SQLite
      if (get().captures.length === 0) {
        try {
          const caps = withColors(await ipc.loadCaptures(id));
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

    nextCapture: () => {
      const n = get().captures.length;
      return {
        id:    makeId(),
        color: PALETTE[n % PALETTE.length],
      };
    },

    // The backend has already saved it (database row + .jdx); this only shows it.
    addSavedCapture: (cap) => set((s) => {
      // The capture-saved event may have brought it in already.
      if (cap.sessionId !== s.activeId || s.captures.some(c => c.id === cap.id)) return;
      s.captures.push(cap);
      const session = s.sessions.find(ss => ss.id === cap.sessionId);
      if (session) session.captureCount += 1;
    }),

    syncCaptures: async (sessionId) => {
      if (sessionId !== get().activeId) {
        set(s => { delete s.stash[sessionId]; });   // reload when next opened
        return;
      }
      const all = withColors(await ipc.loadCaptures(sessionId));
      set(s => {
        if (s.activeId !== sessionId) return;
        const known = new Set(s.captures.map(c => c.id));
        for (const c of all) if (!known.has(c.id)) s.captures.push(c);
        const session = s.sessions.find(x => x.id === sessionId);
        if (session) session.captureCount = s.captures.length;
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
          s.activeId  = remaining[0]?.id ?? null;
          s.captures  = remaining[0] ? (s.stash[remaining[0].id] ?? []) : [];
        }
      });
      try { await ipc.deleteSession(id); }
      catch (e) { console.warn('deleteSession:', e); toast('Failed to delete session from disk.', 'error'); }

      // Deleting the last session would leave nowhere to put a capture, so a
      // fresh default takes its place.
      if (get().sessions.length === 0) {
        const session = get().addSession(DEFAULT_SESSION_NAME, '', '');
        set(s => { s.activeId = session.id; s.captures = []; });
        return;
      }
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

// The backend files captures in the active workspace, so it has to know which
// one that is — whichever way it changed (start-up, switch, delete).
useSessionStore.subscribe((s, prev) => {
  if (s.activeId && s.activeId !== prev.activeId) {
    ipc.writeSetting('workspace.active', s.activeId).catch(e => console.warn('workspace.active:', e));
    useRecentStore.getState().markOpened(s.activeId);
  }
});
