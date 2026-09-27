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
  /** Which calibration frames the backend actually holds. */
  calHeld: { dark: boolean; reference: boolean };
  /** Scan-by-scan progress of a capture in flight; null when idle. */
  captureProgress: { done: number; total: number } | null;

  setParam: <K extends keyof AcqParams>(key: K, value: AcqParams[K]) => void;
  setCursor: (c: CursorState | null) => void;
  setPaused: (v: boolean) => void;
  setLiveSpectrum: (s: Spectrum) => void;
  /** Re-read instrument state from the backend. Called on a timer, and directly
   *  after anything that changes it so the UI does not wait for the next tick. */
  refreshInstrument: () => Promise<void>;
  /** Take one measurement of `averaging` scans and file it in the session.
   *  Lives here so the Capture button and the Space shortcut run the same code
   *  — they used to take captures by two different routes. */
  runCapture: (tag?: string) => Promise<void>;
}

export const useAcqStore = create<AcqStore>()(
  immer((set, get) => ({
    params: {
      mode: 'absorbance',
      acqMode: 'continuous',
      integration: 120,
      averaging: 4,
      lightOn: true,
      lightPower: 80,
      xUnit: 'nm',
      yUnit: 'au',
      lockAxes: false,
      stack: false,
    },
    cursor: null,
    paused: false,
    liveSpectrum: null,
    deviceMeta:   null,
    calHeld:      { dark: false, reference: false },
    captureProgress: null,

    setParam: (key, value) =>
      set((s) => { s.params[key] = value; }),


    setCursor: (c) =>
      set((s) => { s.cursor = c; }),

    setPaused: (v) =>
      set((s) => { s.paused = v; }),

    runCapture: async (tag = '') => {
      if (get().captureProgress) return;   // one measurement at a time
      // Capture only from a frozen plot. While Live is running the trace is
      // moving, so there is no particular spectrum being captured — you would
      // be recording whatever the device happened to be doing. Freeze first,
      // look at what you have, then record it.
      if (!get().paused) {
        useUIStore.getState().pushToast('Turn Live off before capturing.', 'info');
        return;
      }
      const params = get().params;
      set((s) => { s.captureProgress = { done: 0, total: Math.max(1, params.averaging) }; });
      const stop = ipc.onCaptureProgress((done, total) =>
        set((s) => { s.captureProgress = { done, total }; }));
      try {
        const spectrum = await ipc.capture(params);
        // Written once, at the end: an average is not meaningful until every
        // scan is in it.
        set((s) => { s.liveSpectrum = spectrum; });
        useSessionStore.getState().addCapture(params, spectrum.xs, spectrum.ys, tag);
      } catch (e) {
        useUIStore.getState().pushToast(String(e), 'error');
      } finally {
        stop();
        set((s) => { s.captureProgress = null; });
        // Live is off by definition here, so the stream stays stopped: the
        // captured spectrum remains on screen instead of being overwritten by
        // the next frame.
      }
    },

    refreshInstrument: async () => {
      const [meta, cal] = await Promise.all([
        ipc.getDeviceMetadata().catch(() => null),
        ipc.getCalibrationState().catch(() => ({ dark: false, reference: false })),
      ]);
      set((s) => {
        s.deviceMeta = meta;
        s.calHeld = cal;
        // With the Abs/Refl/Trans chips gone, what the pipeline computes follows
        // from what has been measured rather than from a button:
        //   neither          → raw counts
        //   dark only        → dark-subtracted counts
        //   dark + reference → absorbance
        // 'intensity' is the mode meaning "subtract the dark if there is one";
        // 'absorbance' needs both frames.
        s.params.mode = cal.dark && cal.reference ? 'absorbance' : 'intensity';
      });
    },

    setLiveSpectrum: (spectrum) =>
      set((s) => { s.liveSpectrum = spectrum; }),
  }))
);
