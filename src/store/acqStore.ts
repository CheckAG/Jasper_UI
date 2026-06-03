import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AcqParams, RefState, CursorState, Spectrum } from '../lib/types';

interface AcqStore {
  params: AcqParams;
  refState: RefState;
  cursor: CursorState | null;
  paused: boolean;
  liveSpectrum: Spectrum | null;

  setParam: <K extends keyof AcqParams>(key: K, value: AcqParams[K]) => void;
  setRefState: (patch: Partial<RefState>) => void;
  setCursor: (c: CursorState | null) => void;
  setPaused: (v: boolean) => void;
  setLiveSpectrum: (s: Spectrum) => void;
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
    refState: {
      dark: 'ok',
      reference: 'ok',
      xcal: 'ok',
      live: true,
    },
    cursor: null,
    paused: false,
    liveSpectrum: null,

    setParam: (key, value) =>
      set((s) => { s.params[key] = value; }),

    setRefState: (patch) =>
      set((s) => { Object.assign(s.refState, patch); }),

    setCursor: (c) =>
      set((s) => { s.cursor = c; }),

    setPaused: (v) =>
      set((s) => { s.paused = v; }),

    setLiveSpectrum: (spectrum) =>
      set((s) => { s.liveSpectrum = spectrum; }),
  }))
);
