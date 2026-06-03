import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { PipelineNode, PipelineResult, NodeKind } from '../lib/types';
import { ipc } from '../lib/ipc';

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

function makeId() { return Math.random().toString(36).slice(2, 9); }

const NODE_DEFAULTS: Record<NodeKind, { name: string; code: string; params: Record<string, number> }> = {
  boxcar:  { name: 'Boxcar smooth',    code: 'AT_3_1', params: { window: 9 } },
  sg:      { name: 'Savitzky–Golay',   code: 'AT_3_2', params: { window: 11, poly: 2, deriv: 0 } },
  snv:     { name: 'SNV',              code: 'AT_1_1', params: {} },
  msc:     { name: 'MSC',              code: 'AT_1_2', params: {} },
  detrend: { name: 'Detrend',          code: 'AT_1_3', params: {} },
  norm:    { name: 'Normalize (peak)', code: 'AT_2',   params: {} },
  deriv:   { name: 'Derivative',       code: 'AT_4_2', params: { order: 1 } },
};

interface AnalyzeStore {
  pipeline:       PipelineNode[];
  selectedNodeId: string | null;
  isExecuting:    boolean;
  lastResult:     PipelineResult | null;
  captureYs:      Array<{ id: string; ys: Float32Array }>;

  addNode:        (kind: NodeKind) => void;
  removeNode:     (id: string) => void;
  toggleNode:     (id: string) => void;
  setNode:        (id: string, patch: Partial<PipelineNode>) => void;
  reorderNodes:   (fromIdx: number, toIdx: number) => void;
  setSelectedNode:(id: string | null) => void;
  setCaptureYs:   (ys: Array<{ id: string; ys: Float32Array }>) => void;
  executePipeline:() => void;   // debounced 150ms
  clearResult:    () => void;
}

export const useAnalyzeStore = create<AnalyzeStore>()(
  immer((set, get) => ({
    pipeline:       [],
    selectedNodeId: null,
    isExecuting:    false,
    lastResult:     null,
    captureYs:      [],

    addNode: (kind) => {
      const def = NODE_DEFAULTS[kind];
      const node: PipelineNode = { id: makeId(), kind, enabled: true, ...def };
      set(s => { s.pipeline.push(node); });
      get().executePipeline();
    },

    removeNode: (id) => {
      set(s => {
        s.pipeline = s.pipeline.filter(n => n.id !== id);
        if (s.selectedNodeId === id) s.selectedNodeId = null;
      });
      get().executePipeline();
    },

    toggleNode: (id) => {
      set(s => {
        const n = s.pipeline.find(n => n.id === id);
        if (n) n.enabled = !n.enabled;
      });
      get().executePipeline();
    },

    setNode: (id, patch) => {
      set(s => {
        const n = s.pipeline.find(n => n.id === id);
        if (n) Object.assign(n, patch);
      });
      get().executePipeline();
    },

    reorderNodes: (fromIdx, toIdx) => {
      set(s => {
        const [node] = s.pipeline.splice(fromIdx, 1);
        s.pipeline.splice(toIdx, 0, node);
      });
      get().executePipeline();
    },

    setSelectedNode: (id) => set(s => { s.selectedNodeId = id; }),

    setCaptureYs: (ys) => {
      set(s => { s.captureYs = ys; });
      get().executePipeline();
    },

    executePipeline: () => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(async () => {
        const { pipeline, captureYs } = get();
        if (captureYs.length === 0) return;
        set(s => { s.isExecuting = true; });
        try {
          const result = await ipc.applyPipeline(pipeline, captureYs);
          set(s => { s.lastResult = result; s.isExecuting = false; });
        } catch {
          set(s => { s.isExecuting = false; });
        }
      }, 150);
    },

    clearResult: () => set(s => { s.lastResult = null; }),
  }))
);
