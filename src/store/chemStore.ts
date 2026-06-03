import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ModelMeta, PCAResult, RegressionResult,
  PredictionResult, MixtureResult, ChemAlgorithm,
} from '../lib/types';
import { ipc } from '../lib/ipc';

type ChemTab = 'explore' | 'classify' | 'regress' | 'predict' | 'mixture';

interface ChemStore {
  models:             ModelMeta[];
  activeModelId:      string | null;
  activeTab:          ChemTab;
  pcaResult:          PCAResult | null;
  regressionResult:   RegressionResult | null;
  predictionResult:   PredictionResult | null;
  mixtureResult:      MixtureResult | null;
  nComponents:        number;
  isTraining:         boolean;
  isRunning:          boolean;
  error:              string | null;

  setTab:        (tab: ChemTab) => void;
  setActiveModel:(id: string | null) => void;
  setComponents: (n: number) => void;
  loadModels:    () => Promise<void>;
  deleteModel:   (id: string) => Promise<void>;

  runPCA:     (spectra: Float32Array[], labels: string[]) => Promise<void>;
  trainModel: (
    algorithm: ChemAlgorithm,
    captureIds: string[],
    spectra: Float32Array[],
    labels: number[] | string[]
  ) => Promise<void>;
  predict:        (spectrum: Float32Array, modelId: string) => Promise<void>;
  analyzeMixture: (ys: Float32Array, componentIds: string[]) => Promise<void>;
}

export const useChemStore = create<ChemStore>()(
  immer((set, get) => ({
    models:           [],
    activeModelId:    null,
    activeTab:        'explore',
    pcaResult:        null,
    regressionResult: null,
    predictionResult: null,
    mixtureResult:    null,
    nComponents:      4,
    isTraining:       false,
    isRunning:        false,
    error:            null,

    setTab:         (tab) => set(s => { s.activeTab = tab; }),
    setActiveModel: (id)  => set(s => { s.activeModelId = id; }),
    setComponents:  (n)   => set(s => { s.nComponents = n; }),

    loadModels: async () => {
      try {
        const models = await ipc.loadModels();
        set(s => { s.models = models; });
      } catch (e) {
        set(s => { s.error = String(e); });
      }
    },

    deleteModel: async (id) => {
      set(s => { s.models = s.models.filter(m => m.id !== id); });
    },

    runPCA: async (spectra, labels) => {
      set(s => { s.isRunning = true; s.error = null; });
      try {
        const result = await ipc.runPCA(spectra, labels, get().nComponents);
        set(s => { s.pcaResult = result; s.isRunning = false; });
      } catch (e) {
        set(s => { s.error = String(e); s.isRunning = false; });
      }
    },

    trainModel: async (algorithm, _captureIds, spectra, labels) => {
      set(s => { s.isTraining = true; s.error = null; });
      try {
        const meta = await ipc.trainModel(algorithm, spectra, labels, {});
        set(s => { s.models.unshift(meta); s.activeModelId = meta.id; s.isTraining = false; });
      } catch (e) {
        set(s => { s.error = String(e); s.isTraining = false; });
      }
    },

    predict: async (spectrum, modelId) => {
      set(s => { s.isRunning = true; s.error = null; });
      try {
        const result = await ipc.predictFromModel(spectrum, modelId);
        set(s => { s.predictionResult = result; s.isRunning = false; });
      } catch (e) {
        set(s => { s.error = String(e); s.isRunning = false; });
      }
    },

    analyzeMixture: async (ys, componentIds) => {
      set(s => { s.isRunning = true; s.error = null; });
      try {
        const result = await ipc.analyzeMixture(ys, componentIds);
        set(s => { s.mixtureResult = result; s.isRunning = false; });
      } catch (e) {
        set(s => { s.error = String(e); s.isRunning = false; });
      }
    },
  }))
);
