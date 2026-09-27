import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AcqParams, CursorState, Spectrum, DeviceMetadata } from '../lib/types';
import { ipc } from '../lib/ipc';

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

  setParam: <K extends keyof AcqParams>(key: K, value: AcqParams[K]) => void;
  setCursor: (c: CursorState | null) => void;
  setPaused: (v: boolean) => void;
  setLiveSpectrum: (s: Spectrum) => void;
  /** Re-read instrument state from the backend. Called on a timer, and directly
   *  after anything that changes it so the UI does not wait for the next tick. */
  refreshInstrument: () => Promise<void>;
}

export const useAcqStore = create<AcqStore>()(
  immer((set) => ({
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

    setParam: (key, value) =>
      set((s) => { s.params[key] = value; }),


    setCursor: (c) =>
      set((s) => { s.cursor = c; }),

    setPaused: (v) =>
      set((s) => { s.paused = v; }),

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
