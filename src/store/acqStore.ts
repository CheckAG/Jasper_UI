import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AcqParams, CursorState, Spectrum, DeviceMetadata } from '../lib/types';
import { ipc } from '../lib/ipc';
import { useSessionStore } from './sessionStore';
import { useUIStore } from './uiStore';

interface AcqStore {
  params: AcqParams;
  cursor: CursorState | null;
  paused: boolean;
  liveSpectrum: Spectrum | null;
  /** What the backend reports about the connected instrument; null when none.
   *  Held here rather than fetched per component, so the top bar, the Instrument
   *  panel and the Acquire strip cannot disagree about what is connected. */
  deviceMeta: DeviceMetadata | null;
  /** The connected board went away (cable pulled); the backend is looking for it. */
  reconnecting: boolean;
  /** Which calibration frames the backend actually holds. */
  calHeld: { dark: boolean; reference: boolean };
  /** The held dark was taken at other integration/averaging than now. */
  darkStale: boolean;
  /** Live frames per second, smoothed; 0 when not streaming. */
  fps: number;
  /** Scan-by-scan progress of a capture in flight; null when idle. */
  captureProgress: { done: number; total: number } | null;
  /** The dark or reference being taken or discarded right now. */
  calBusy: 'dark' | 'reference' | null;
  /** A burst is running; `captureProgress` then counts shots, not scans. */
  bursting: boolean;

  setParam: <K extends keyof AcqParams>(key: K, value: AcqParams[K]) => void;
  setCursor: (c: CursorState | null) => void;
  /** Turn Live on or off. Asks the backend; `paused` follows what it reports. */
  setPaused: (v: boolean) => void;
  /** Change integration or averaging on the backend, which owns them. */
  writeSetting: (key: 'integration' | 'averaging', value: number) => Promise<void>;
  setLiveSpectrum: (s: Spectrum) => void;
  /** Re-read instrument state from the backend. Called on a timer, and directly
   *  after anything that changes it so the UI does not wait for the next tick. */
  refreshInstrument: () => Promise<void>;
  /** Take one measurement of `averaging` scans and file it in the session.
   *  Lives here so the Capture button and the Space shortcut run the same code
   *  — they used to take captures by two different routes. */
  runCapture: (tag?: string) => Promise<void>;
  /** Sample tag typed in the controls column; filed with every capture, however it is triggered. */
  sampleTag: string;
  setSampleTag: (t: string) => void;
  /** Name for the next capture; empty means automatic (spectra_NNN). Cleared after each capture. */
  captureName: string;
  setCaptureName: (n: string) => void;
  /** Run a burst: `count` captures `intervalMs` apart, each filed in the workspace.
   *  Progress shows in `captureProgress` as shots, so Capture waits for it. */
  runBurst: (count: number, intervalMs: number, label: string, tag: string) => Promise<void>;
  /** Take a dark or reference from the spectrum on the plot, or discard the one
   *  held. Shared by the toolbar, the Acquire menu and the D / R shortcuts. */
  toggleCal: (which: 'dark' | 'reference') => Promise<void>;
}

export const useAcqStore = create<AcqStore>()(
  immer((set, get) => ({
    params: {
      mode: 'absorbance',
      acqMode: 'continuous',
      integration: 120,
      averaging: 4,
      xUnit: 'nm',
      yUnit: 'au',
      lockAxes: false,
      stack: false,
    },
    cursor: null,
    // Live starts off: streaming is something the user turns on, not a side
    // effect of connecting.
    paused: true,
    liveSpectrum: null,
    deviceMeta:   null,
    reconnecting: false,
    calHeld:      { dark: false, reference: false },
    darkStale:    false,
    fps:          0,
    captureProgress: null,
    calBusy:      null,
    bursting:     false,
    sampleTag:    '',
    captureName:  '',
    setCaptureName: (n) => set((s) => { s.captureName = n; }),

    setSampleTag: (t) => set((s) => { s.sampleTag = t; }),

    setParam: (key, value) =>
      set((s) => { s.params[key] = value; }),


    setCursor: (c) =>
      set((s) => { s.cursor = c; }),

    // Live needs a device. Guarded here so the button and the L shortcut both
    // respect it; the backend refuses too.
    setPaused: (v) => {
      if (!v && !get().deviceMeta) return;
      set((s) => { s.paused = v; });   // optimistic; the refresh below corrects it
      (v ? ipc.stopLive() : ipc.startLive())
        .catch(e => useUIStore.getState().pushToast(String(e), 'error'))
        .finally(() => get().refreshInstrument());
    },

    writeSetting: async (key, value) => {
      try {
        const applied = await ipc.writeSetting(
          key === 'integration' ? 'acquisition.integration_time_ms' : 'acquisition.averages', value);
        set((s) => { s.params[key] = Number(applied); });
        get().refreshInstrument();   // stale-dark and friends follow at once, not on the next poll
      } catch (e) {
        useUIStore.getState().pushToast(String(e), 'error');
      }
    },

    runCapture: async (tag = get().sampleTag) => {
      if (get().captureProgress) return;   // one measurement at a time
      // Capture only from a frozen plot. While Live is running the trace is
      // moving, so there is no particular spectrum being captured.
      if (!get().paused) {
        useUIStore.getState().pushToast('Turn Live off before capturing.', 'info');
        return;
      }
      const sessions = useSessionStore.getState();
      const sessionId = sessions.activeId;
      if (!sessionId) return;
      const { id, color } = sessions.nextCapture();
      set((s) => { s.captureProgress = { done: 0, total: Math.max(1, get().params.averaging) }; });
      const stop = ipc.onCaptureProgress((done, total) =>
        set((s) => { s.captureProgress = { done, total }; }));
      try {
        // The backend measures and files it: a database row and a .jdx file.
        const r = await ipc.capture({ id, label: get().captureName.trim(), tag, color });
        set((s) => { s.liveSpectrum = r.spectrum; });
        if (!r.saved) {
          useUIStore.getState().pushToast('Captured, but no workspace is active, so it was not saved.', 'error');
          return;
        }
        // One custom name per capture: the next one is automatic again unless renamed.
        set((s) => { s.captureName = ''; });
        const label = r.label;
        useSessionStore.getState().addSavedCapture({
          id, sessionId, label, timestamp: r.timestamp, tag, params: r.params,
          xs: r.spectrum.xs, ys: r.spectrum.ys, color,
        });
        if (r.fileError) useUIStore.getState().pushToast(`"${label}" is in the database, but its .jdx file was not written: ${r.fileError}`, 'error');
        else if (r.file) useUIStore.getState().pushToast(`Saved ${r.file.split(/[\\/]/).pop()}`, 'success');
      } catch (e) {
        useUIStore.getState().pushToast(String(e), 'error');
      } finally {
        stop();
        set((s) => { s.captureProgress = null; });
      }
    },

    runBurst: async (count, intervalMs, label, tag) => {
      if (get().captureProgress) return;
      if (!get().paused) {
        useUIStore.getState().pushToast('Turn Live off before a burst.', 'info');
        return;
      }
      set((s) => { s.captureProgress = { done: 0, total: count }; s.bursting = true; });
      const stop = ipc.onBurstProgress((done, total) =>
        set((s) => { s.captureProgress = { done, total }; }));
      try {
        const r = await ipc.burst({ count, intervalMs, label: label.trim(), tag }, get().params);
        if (r.spectrum) set((s) => { s.liveSpectrum = r.spectrum; });
        // The shots reach the Captures panel through capture-saved.
        useUIStore.getState().pushToast(r.stopped ? `Burst stopped: ${r.taken} of ${r.total} saved.`
          : `Burst done: ${r.taken} captures saved.`, r.stopped ? 'info' : 'success');
      } catch (e) {
        useUIStore.getState().pushToast(String(e), 'error');
      } finally {
        stop();
        set((s) => { s.captureProgress = null; s.bursting = false; });
      }
    },

    // The button is the state: with nothing stored it takes one; with a frame
    // stored it flushes it. A dark taken at the wrong integration, or a
    // reference against the wrong standard, is worse than none — so getting rid
    // of one has to be one press.
    toggleCal: async (which) => {
      const { calBusy, calHeld, liveSpectrum, refreshInstrument } = get();
      if (calBusy) return;
      if (!calHeld[which] && !liveSpectrum) {
        useUIStore.getState().pushToast('No spectrum on the plot yet.', 'info');
        return;
      }
      set((s) => { s.calBusy = which; });
      try {
        if (calHeld[which]) {
          await ipc.clearCalibration(which);
        } else {
          // Tags the spectrum already on the plot — it does not measure again.
          // Freeze a good trace with Live, then designate it.
          const r = await ipc.tagLastFrame(which);
          if (r.warn) useUIStore.getState().pushToast(`${which}: ${r.warn}`, 'info');
        }
        await refreshInstrument();
      } catch (e) {
        useUIStore.getState().pushToast(String(e), 'error');
      } finally {
        set((s) => { s.calBusy = null; });
      }
    },

    refreshInstrument: async () => {
      let st;
      try { st = await ipc.readInstrument(); } catch { return; }
      const was = get().reconnecting;
      if (st.reconnecting && !was) useUIStore.getState().pushToast('Instrument lost. Reconnect the cable; JASPER will pick it up again.', 'error');
      if (!st.reconnecting && was && st.meta) useUIStore.getState().pushToast('Instrument reconnected.', 'success');
      set((s) => {
        s.reconnecting = st.reconnecting;
        // A new (or lost) device: the last frame belongs to the old one, so it
        // goes; otherwise Dark/Reference stay enabled against a spectrum that is gone.
        if (st.meta?.serial !== s.deviceMeta?.serial) s.liveSpectrum = null;
        s.deviceMeta = st.meta;
        s.calHeld = { dark: st.dark, reference: st.reference };
        s.darkStale = st.darkStale;
        // Everything below is owned by the backend; the store only mirrors it.
        s.paused = !st.live;
        if (!st.live) s.fps = 0;
        s.params.integration = st.integration;
        s.params.averaging = st.averaging;
        s.params.mode = st.mode;
      });
    },

    setLiveSpectrum: (spectrum) =>
      set((s) => {
        // Rate from the device timestamps, smoothed so the readout does not flicker.
        const dt = s.liveSpectrum ? spectrum.timestamp - s.liveSpectrum.timestamp : 0;
        if (dt > 0) s.fps = s.fps ? 0.8 * s.fps + 0.2 * (1000 / dt) : 1000 / dt;
        s.liveSpectrum = spectrum;
      }),
  }))
);
