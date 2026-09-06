// ============================================================
// JASPER — IPC boundary
//
// Phase A  → all calls used mock implementations
// Phase B  → instrument + storage → real Tauri invoke/listen
// Phase C  → pipeline/chemometrics → Python sidecar
//
// Rule: no component calls invoke() directly. All Tauri calls live here.
// ============================================================

import { invoke } from '@tauri-apps/api/core';
import { listen  } from '@tauri-apps/api/event';

import { generateSpectrum } from './mockDriver';
import type {
  AcqParams, Spectrum, DeviceInfo, DeviceEvent, DeviceMetadata, DiagEntry,
  CalResult, XCalResult, PipelineNode, PipelineResult,
  ChemAlgorithm, ModelMeta, PCAResult, RegressionResult,
  PredictionResult, MixtureResult, Session, Capture,
} from './types';
import type {
  DeviceRowDTO, DiagEntryDTO, DeviceMetadataDTO, FrameDTO, CalResultDTO, XCalResultDTO,
  SessionRowDTO, CaptureRowDTO, ManifestNodeDTO, PipelineResultDTO,
  ReloadPluginsDTO, PCAResultDTO, TrainResultDTO, PredictionResultDTO,
  MixtureResultDTO,
} from './dto';

// ── Runtime flag ─────────────────────────────────────────────────────────────
// When true: real Tauri commands are used.
// In tests / browser dev (non-Tauri context) we fall back to mocks.
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Helpers ───────────────────────────────────────────────────────────────────

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/** Call a method on the Python sidecar via the Rust cmd_sidecar_request bridge. */
function sidecarCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>('cmd_sidecar_request', { method, params });
}

/** Map a sidecar node manifest into frontend PipelineNode shapes. */
function mapManifest(nodes: ManifestNodeDTO[]): PipelineNode[] {
  return nodes.map((n, i) => ({
    id:      `n-${n.code ?? i}`,
    kind:    (n.code ?? '').toLowerCase().replace('at_', '') as PipelineNode['kind'],
    name:    n.name,
    code:    n.code,
    enabled: false,
    params:  Object.fromEntries(
      Object.entries(n.params ?? {}).map(([k, v]) => [k, v.default ?? 0])
    ),
  }));
}

// Convert AcqParams (camelCase) → Rust snake_case
function toRustParams(p: AcqParams) {
  return {
    mode: p.mode, acq_mode: p.acqMode,
    integration: p.integration, averaging: p.averaging,
    light_on: p.lightOn, light_power: p.lightPower,
    x_unit: p.xUnit, y_unit: p.yUnit,
    lock_axes: p.lockAxes, stack: p.stack,
  };
}

// Rust SpectrumFrame → TypeScript Spectrum
function frameToSpectrum(
  frame: { xs: number[]; ys: number[]; timestamp: number; units?: string },
  params: AcqParams,
): Spectrum {
  return {
    xs: new Float32Array(frame.xs),
    ys: new Float32Array(frame.ys),
    timestamp: frame.timestamp,
    params,
    units: frame.units,
  };
}

// ── Mock fallbacks (used when not in Tauri, i.e. browser dev) ─────────────────

function mockPCA(labels: string[]): PCAResult {
  return {
    scores: labels.map((_, i) => [
      (Math.random() - 0.5) * 4 + (i % 3) * 2,
      (Math.random() - 0.5) * 3 + Math.floor(i / 3),
    ]),
    loadings: [[0.8, 0.6], [0.3, 0.9]],
    explainedVariance: [0.61, 0.22, 0.09, 0.04],
    labels,
  };
}

function mockRegression(n: number): RegressionResult {
  const actual = Array.from({ length: n }, (_, i) => 10 + i * 2 + Math.random());
  const predicted = actual.map(v => v + (Math.random() - 0.5) * 1.5);
  const rmsep = Math.sqrt(predicted.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0) / n);
  return { predicted, actual, rmsep, r2: 0.94, bias: 0.03, nComponents: 4 };
}

// ── IPC object ─────────────────────────────────────────────────────────────────

export const ipc = {

  // ── Instrument ──────────────────────────────────────────────────────────────

  /** Instruments that answered a protocol handshake. Empty when none are
   *  attached — the browser has no serial ports at all, so it lists nothing
   *  rather than inventing devices. */
  discoverDevices: (): Promise<DeviceInfo[]> => IS_TAURI
    ? tauriInvoke<DeviceRowDTO[]>('cmd_discover_devices').then(ds => ds.map(d => ({
        id: d.id, name: d.name, model: d.model,
        status: d.status as DeviceInfo['status'],
        serial: d.serial, firmware: d.firmware,
      })))
    : Promise.resolve([]),

  connectDevice: (deviceId: string): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_connect_device', { deviceId })
    : Promise.resolve(),

  disconnectDevice: (): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_disconnect_device')
    : Promise.resolve(),

  /** Identity and limits of the connected instrument, or null when nothing is
   *  connected. Never throws for "no device" — that is an empty state, not an error. */
  getDeviceMetadata: (): Promise<DeviceMetadata | null> => IS_TAURI
    ? tauriInvoke<DeviceMetadataDTO | null>('cmd_get_device_metadata').then(m => m && ({
        port: m.port, manufacturer: m.manufacturer, model: m.model, serial: m.serial,
        firmware: m.firmware, protocolVersion: m.protocol_version, pixels: m.pixels,
        integMinMs: m.integ_min_ms, integMaxMs: m.integ_max_ms,
        maxIntensity: m.max_intensity, sensor: m.sensor, lastSeq: m.last_seq,
        droppedFrames: m.dropped_frames, lastCaptureMs: m.last_capture_ms,
        timestamp: m.timestamp,
      }))
    : Promise.resolve(null),

  scan: (params: AcqParams): Promise<Spectrum> => IS_TAURI
    ? tauriInvoke<FrameDTO>('cmd_scan', { params: toRustParams(params) })
        .then(f => frameToSpectrum(f, params))
    : Promise.resolve(generateSpectrum(params, performance.now() / 1000)),

  startAcquisition: (params: AcqParams): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_start_acquisition', { params: toRustParams(params) })
    : Promise.resolve(),

  stopAcquisition: (): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_stop_acquisition')
    : Promise.resolve(),

  calibrateDark: (params: AcqParams): Promise<CalResult> => IS_TAURI
    ? tauriInvoke<CalResultDTO>('cmd_calibrate_dark', { params: toRustParams(params) })
        .then(r => ({ status: r.status as CalResult['status'], rms: r.rms ?? undefined, warn: r.warn ?? undefined }))
    : new Promise(resolve => setTimeout(() => resolve({ status: 'ok' }), 700)),

  calibrateReference: (params: AcqParams): Promise<CalResult> => IS_TAURI
    ? tauriInvoke<CalResultDTO>('cmd_calibrate_reference', { params: toRustParams(params) })
        .then(r => ({ status: r.status as CalResult['status'], rms: r.rms ?? undefined, warn: r.warn ?? undefined }))
    : new Promise(resolve => setTimeout(() => resolve({ status: 'ok' }), 700)),

  calibrateXcal: (): Promise<XCalResult> => IS_TAURI
    ? tauriInvoke<XCalResultDTO>('cmd_calibrate_xcal')
        .then(r => ({
          status: r.status as XCalResult['status'], rms: r.rms,
          coefficients: r.coefficients, peaksFound: r.peaks_found,
        }))
    : new Promise(resolve => setTimeout(() =>
        resolve({ status: 'ok', rms: 0.018, coefficients: [400, 1.6], peaksFound: 12 }), 1400)),

  /** Instrument events, newest last. Empty until something has happened. */
  getDiagnostics: (): Promise<DiagEntry[]> => IS_TAURI
    ? tauriInvoke<DiagEntryDTO[]>('cmd_get_diagnostics').then(es => es.map(e => ({
        id: e.id, ts: e.ts,
        severity: e.severity as DiagEntry['severity'],
        message: e.message,
      })))
    : Promise.resolve([]),

  // ── Storage ─────────────────────────────────────────────────────────────────

  saveSession: (session: Session): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_save_session', { session: {
        id: session.id, name: session.name,
        operator: session.operator ?? null,
        device: session.device ?? null,
        method_id: session.method ?? null,
        created_at: session.createdAt,
        status: session.status,
        signed_at: null, signed_by: null, params_json: null,
        calibration_json: null, notes: null,
      }})
    : Promise.resolve(),

  loadSessions: (): Promise<Session[]> => IS_TAURI
    ? tauriInvoke<SessionRowDTO[]>('cmd_load_sessions').then(rows => rows.map(r => ({
        id: r.id, name: r.name, device: r.device ?? '',
        method: r.method_id ?? '', operator: r.operator ?? '',
        createdAt: r.created_at, status: r.status as Session['status'],
        captureCount: r.capture_count ?? 0,
      })))
    : Promise.resolve([]),

  saveCapture: (capture: Capture): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_save_capture', { capture: {
        id: capture.id, session_id: capture.sessionId,
        label: capture.label, timestamp: capture.timestamp,
        tag: capture.tag, params_json: JSON.stringify(capture.params),
        xs: Array.from(capture.xs), ys: Array.from(capture.ys),
        color: capture.color, position: null,
      }})
    : Promise.resolve(),

  loadCaptures: (sessionId: string): Promise<Capture[]> => IS_TAURI
    ? tauriInvoke<CaptureRowDTO[]>('cmd_load_captures', { sessionId }).then(rows =>
        rows.map(r => ({
          id: r.id, sessionId: r.session_id,
          label: r.label ?? '', timestamp: r.timestamp,
          tag: r.tag ?? '', params: JSON.parse(r.params_json) as AcqParams,
          xs: new Float32Array(r.xs), ys: new Float32Array(r.ys),
          color: r.color ?? '#1f5dff',
        })))
    : Promise.resolve([]),

  deleteSession: (id: string): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_delete_session', { id })
    : Promise.resolve(),

  deleteCapture: (id: string): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_delete_capture', { id })
    : Promise.resolve(),

  // ── Pipeline (Phase C: Python sidecar) ──────────────────────────────────────

  applyPipeline: (
    nodes: PipelineNode[],
    captures: Array<{ id: string; ys: Float32Array }>
  ): Promise<PipelineResult> => {
    if (!IS_TAURI) {
      return Promise.resolve({
        nodes: nodes.map(n => ({ ...n, outputPreview: captures[0]?.ys })),
        final: captures[0]?.ys ?? new Float32Array(0),
        durationMs: 1,
      });
    }
    return sidecarCall<PipelineResultDTO>('apply_pipeline', {
      nodes: nodes.map(n => ({ id: n.id, code: n.code, enabled: n.enabled, params: n.params })),
      captures: captures.map(c => ({ id: c.id, ys: Array.from(c.ys) })),
    }).then(r => ({
      nodes: r.nodes.map(n => ({
        ...(nodes.find(x => x.id === n.id) ?? { ...n, kind: n.code as PipelineNode['kind'], name: n.code }),
        outputPreview: n.output_preview ? new Float32Array(n.output_preview) : undefined,
      })),
      final: new Float32Array(r.final ?? []),
      durationMs: r.duration_ms ?? 0,
    }));
  },

  getNodeManifest: (): Promise<PipelineNode[]> => {
    if (!IS_TAURI) {
      return Promise.resolve<PipelineNode[]>([
        { id: 'n-boxcar',  kind: 'boxcar',  name: 'Boxcar smooth',    code: 'AT_3_1', enabled: false, params: { window: 9 } },
        { id: 'n-sg',      kind: 'sg',      name: 'Savitzky–Golay',   code: 'AT_3_2', enabled: false, params: { window: 11, poly: 2, deriv: 0 } },
        { id: 'n-snv',     kind: 'snv',     name: 'SNV',              code: 'AT_1_1', enabled: false, params: {} },
        { id: 'n-msc',     kind: 'msc',     name: 'MSC',              code: 'AT_1_2', enabled: false, params: {} },
        { id: 'n-detrend', kind: 'detrend', name: 'Detrend',          code: 'AT_1_3', enabled: false, params: {} },
        { id: 'n-norm',    kind: 'norm',    name: 'Normalize (peak)', code: 'AT_2',   enabled: false, params: {} },
        { id: 'n-deriv',   kind: 'deriv',   name: 'Derivative',       code: 'AT_4_2', enabled: false, params: { order: 1 } },
      ]);
    }
    return sidecarCall<ManifestNodeDTO[]>('get_node_manifest', {}).then(mapManifest);
  },

  /** Scan ~/jasper/plugins for user Node subclasses; returns the full node library. */
  reloadPlugins: (): Promise<{ loaded: number; nodes: PipelineNode[] }> => {
    if (!IS_TAURI) return Promise.resolve({ loaded: 0, nodes: [] });
    return sidecarCall<ReloadPluginsDTO>('reload_plugins', {}).then(r => ({
      loaded: r.loaded ?? 0,
      nodes:  mapManifest(r.manifest ?? []),
    }));
  },

  // ── Chemometrics (Phase C: Python sidecar) ───────────────────────────────────

  runPCA: (spectra: Float32Array[], labels: string[], nComponents: number): Promise<PCAResult> => {
    if (!IS_TAURI) return new Promise(resolve => setTimeout(() => resolve(mockPCA(labels)), 400));
    return sidecarCall<PCAResultDTO>('run_pca', {
      spectra: spectra.map(s => Array.from(s)),
      labels,
      n_components: nComponents,
    }).then(r => ({
      scores:            r.scores,
      loadings:          r.loadings,
      explainedVariance: r.explained_variance,
      labels:            r.labels,
    }));
  },

  trainModel: (
    algorithm: ChemAlgorithm,
    spectra: Float32Array[],
    labels: number[] | string[],
    opts: Record<string, unknown>,
  ): Promise<ModelMeta> => {
    if (!IS_TAURI) {
      return new Promise(resolve => setTimeout(() => resolve({
        id: Math.random().toString(36).slice(2), name: `${algorithm.toUpperCase()} · v1`,
        algorithm, version: 1, filePath: `~/jasper/models/mock.joblib`,
        createdAt: Date.now(), createdBy: 'User',
        metrics: { rmsep: 0.42, r2: 0.94, bias: 0.03 }, featureRange: [400, 2000],
      }), 1500));
    }
    const isRegression = ['pls', 'pcr', 'mlr'].includes(algorithm);
    const method = isRegression ? 'train_regression' : 'train_classifier';
    return sidecarCall<TrainResultDTO>(method, {
      spectra: spectra.map(s => Array.from(s)),
      targets: isRegression ? labels : undefined,
      labels:  !isRegression ? labels : undefined,
      algorithm,
      n_components: (opts.nComponents as number) ?? 4,
    }).then(r => ({
      id:           r.model_id,
      name:         `${algorithm.toUpperCase()} · v1`,
      algorithm,
      version:      1,
      filePath:     r.file_path,
      createdAt:    Date.now(),
      createdBy:    'User',
      // The sidecar sends whichever metrics the algorithm produced; drop the
      // absent ones rather than storing undefined in a Record<string, number>.
      metrics:      Object.fromEntries(
        Object.entries({ rmsep: r.rmsep, r2: r.r2, accuracy: r.accuracy })
          .filter((e): e is [string, number] => typeof e[1] === 'number')),
      featureRange: [400, 2000] as [number, number],
    }));
  },

  runRegression: (
    spectra: Float32Array[],
    targets: number[],
    algorithm: ChemAlgorithm,
    nComponents: number,
  ): Promise<RegressionResult> => {
    if (!IS_TAURI) return new Promise(resolve => setTimeout(() => resolve(mockRegression(targets.length || 10)), 600));
    return sidecarCall<TrainResultDTO>('train_regression', {
      spectra: spectra.map(s => Array.from(s)),
      targets,
      algorithm,
      n_components: nComponents,
    }).then(r => ({
      predicted:   r.predicted ?? [],
      actual:      r.actual ?? [],
      rmsep:       r.rmsep ?? 0,
      r2:          r.r2 ?? 0,
      bias:        r.bias ?? 0,
      nComponents: r.n_components ?? nComponents,
    }));
  },

  predictFromModel: (spectrum: Float32Array, modelId: string): Promise<PredictionResult> => {
    if (!IS_TAURI) {
      return new Promise(resolve => setTimeout(() => resolve({
        value: 12.4, unit: '%', ci95: [11.8, 13.0],
        topBands: [{ nm: 1450, contribution: 0.68 }],
      }), 300));
    }
    return sidecarCall<PredictionResultDTO>('predict', {
      spectrum: Array.from(spectrum),
      model_id: modelId,
    }).then(r => ({
      value:    r.value,
      unit:     r.unit ?? '%',
      ci95:     r.ci95,
      topBands: r.top_bands,
    }));
  },

  analyzeMixture: (ys: Float32Array, componentIds: string[]): Promise<MixtureResult> => {
    if (!IS_TAURI) {
      return new Promise(resolve => setTimeout(() => resolve({
        components: [
          { id: 'c1', name: 'Protein',  fraction: 0.42, color: '#1f5dff' },
          { id: 'c2', name: 'Starch',   fraction: 0.31, color: '#06b6c4' },
          { id: 'c3', name: 'Moisture', fraction: 0.19, color: '#6b4ee0' },
          { id: 'c4', name: 'Lipid',    fraction: 0.06, color: '#d97706' },
        ], residual: 0.02,
      }), 500));
    }
    return sidecarCall<MixtureResultDTO>('analyze_mixture', {
      ys:            Array.from(ys),
      component_ids: componentIds,
    }).then(r => ({
      components: r.components.map(c => ({
        id: c.id, name: c.name, fraction: c.fraction, color: c.color,
      })),
      residual: r.residual,
    }));
  },

  loadModels: (): Promise<ModelMeta[]> => Promise.resolve([
    { id: 'm1', name: 'Maize moisture · PLS', algorithm: 'pls', version: 4,
      filePath: '~/jasper/models/m1.joblib', createdAt: Date.now() - 86400000,
      createdBy: 'Mira', metrics: { rmsep: 0.42, r2: 0.94 }, featureRange: [400, 2000] },
    { id: 'm2', name: 'Wheat protein · PLS', algorithm: 'pls', version: 2,
      filePath: '~/jasper/models/m2.joblib', createdAt: Date.now() - 172800000,
      createdBy: 'Anika', metrics: { rmsep: 0.61, r2: 0.91 }, featureRange: [400, 2000] },
  ]),

  // ── Export (Phase D) ─────────────────────────────────────────────────────────

  /** Render multiple spectra to a single JCAMP-DX string via the Python sidecar. */
  writeJcampMulti: (
    spectra: Array<{ xs: number[]; ys: number[]; metadata?: Record<string, unknown> }>,
    pipeline?: unknown[],
  ): Promise<string> => IS_TAURI
    ? sidecarCall<string>('write_jcamp_multi', { spectra, pipeline: pipeline ?? null })
    : Promise.resolve('## JCAMP export requires the desktop app\n##END='),

  /** Open a native save dialog and write `content`. Returns the path, or null if cancelled. */
  saveExport: (defaultName: string, content: string): Promise<string | null> => IS_TAURI
    ? tauriInvoke<string | null>('cmd_save_export', { defaultName, content })
    : Promise.resolve(null),

  /** Append an audit-trail entry (action log — not a persona feature). */
  saveAudit: (entry: {
    id: string; sessionId: string | null; action: string;
    actor: string; timestamp: number; detail: string | null;
  }): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_save_audit', { entry: {
        id: entry.id, session_id: entry.sessionId, action: entry.action,
        actor: entry.actor, timestamp: entry.timestamp, detail: entry.detail,
      }})
    : Promise.resolve(),

  // ── Tauri event listeners ────────────────────────────────────────────────────

  /**
   * Subscribe to real-time spectrum frames from the Rust acquisition thread.
   * Returns an unlisten function.
   *
   * Tauri mode: Rust emits "spectrum-frame" (xs/ys only). The `params` on the
   *   payload are a placeholder — LiveSpectrum reads axis/mode from the store,
   *   and the streamed ys already match because the stream is restarted on
   *   param change (see App.tsx).
   * Browser mode: no-op. liveSpectrum stays null and LiveSpectrum falls back to
   *   its own param-aware mock generator, so the canvas still animates.
   */
  onSpectrumFrame: (cb: (s: Spectrum) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<{ xs: number[]; ys: number[]; mode: string; units: string; timestamp: number }>('spectrum-frame', event => {
      cb({
        xs: new Float32Array(event.payload.xs),
        ys: new Float32Array(event.payload.ys),
        timestamp: event.payload.timestamp,
        units: event.payload.units,
        // Only `mode` matters downstream — LiveSpectrum uses store params for the
        // rest and discards frames whose mode no longer matches the UI.
        params: {
          mode: (event.payload.mode || 'absorbance') as AcqParams['mode'],
          acqMode: 'continuous', integration: 120, averaging: 4,
          lightOn: true, lightPower: 80, xUnit: 'nm', yUnit: 'au', lockAxes: false, stack: false,
        },
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },


  onDeviceEvent: (_cb: (e: DeviceEvent) => void): (() => void) => () => {},
};

export type IPC = typeof ipc;
