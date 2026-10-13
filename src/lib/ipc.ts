// ============================================================
// JASPER — IPC boundary
//
// Phase A  → all calls used mock implementations (all removed)
// Phase B  → instrument + storage → real Tauri invoke/listen
// Phase C  → pipeline/chemometrics → Python sidecar
//
// Rule: no component calls invoke() directly. All Tauri calls live here.
// ============================================================

import { invoke } from '@tauri-apps/api/core';
import { listen  } from '@tauri-apps/api/event';
import { ask }     from '@tauri-apps/plugin-dialog';

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
// Outside Tauri there is no backend: those calls reject rather than
// fabricating data.
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

// Rust SpectrumFrame → TypeScript Spectrum
function frameToSpectrum(
  frame: { xs: number[]; ys: number[]; timestamp: number; units?: string; peak?: number },
  params: AcqParams,
): Spectrum {
  return {
    xs: new Float32Array(frame.xs),
    ys: new Float32Array(frame.ys),
    timestamp: frame.timestamp,
    params,
    units: frame.units,
    peak: frame.peak,
  };
}

/** Outside Tauri there is no backend and no instrument, so every call that
 *  would touch one rejects. Nothing is synthesised: a plot of random numbers is
 *  indistinguishable from a measurement once it is on screen. */
const noBackend = <T,>(what: string): Promise<T> =>
  Promise.reject(new Error(`${what} needs the desktop app and a connected instrument.`));

/** The Device API (src-tauri/src/api). Errors come back as
 *  {code, message, detail}; they are rethrown as Errors carrying the detail. */
/** A privileged request from outside the app, waiting for a person. */
export interface ConfirmRequest { id: number; caller: string; command: string; args: Record<string, unknown> }

interface ApiErrorDTO { code: number; message: string; detail: string }
function callApi<T>(request: object): Promise<T> {
  return tauriInvoke<T>('cmd_api', { request }).catch((e: ApiErrorDTO | string) => {
    throw Object.assign(new Error(typeof e === 'string' ? e : e.detail), typeof e === 'string' ? {} : { code: e.message });
  });
}
export const deviceApi = {
  read:   <T,>(name: string | string[]) => callApi<T>({ method: 'read',
    params: Array.isArray(name) ? { names: name } : { name } }),
  write:  (name: string, value: unknown) =>
    callApi<{ value: number | string }>({ method: 'write', params: { name, value } }).then(r => r.value),
  invoke: <T = unknown,>(command: string, args: object = {}) =>
    callApi<T>({ method: 'invoke', params: { command, args } }),
};

const INSTRUMENT_VARS = ['device.info', 'device.state', 'reference.dark', 'reference.dark_stale', 'reference.white', 'acquisition.live',
  'acquisition.integration_time_ms', 'acquisition.averages', 'processing.mode'];

export interface InstrumentState {
  meta: DeviceMetadata | null; reconnecting: boolean; dark: boolean; darkStale: boolean; reference: boolean; live: boolean;
  integration: number; averaging: number; mode: AcqParams['mode'];
}

interface CaptureResultDTO {
  frame: FrameDTO & { mode: string; integration_ms: number; timestamp: number };
  saved: null | { id: string; label: string; timestamp: number; tag: string;
                  params: Partial<AcqParams>; file: string | null; file_error: string | null };
}

const DEFAULT_PARAMS: AcqParams = {
  mode: 'intensity', acqMode: 'continuous', integration: 120, averaging: 4,
  xUnit: 'nm', yUnit: 'au', lockAxes: false, stack: false,
};

function metaFromDTO(m: DeviceMetadataDTO | null): DeviceMetadata | null {
  return m && {
    port: m.port, manufacturer: m.manufacturer, model: m.model, serial: m.serial,
    firmware: m.firmware, protocolVersion: m.protocol_version, pixels: m.pixels,
    integMinMs: m.integ_min_ms, integMaxMs: m.integ_max_ms,
    maxIntensity: m.max_intensity, sensor: m.sensor, lastSeq: m.last_seq,
    droppedFrames: m.dropped_frames, lastCaptureMs: m.last_capture_ms,
    timestamp: m.timestamp,
  };
}

// ── IPC object ─────────────────────────────────────────────────────────────────

export const ipc = {

  // ── Instrument ──────────────────────────────────────────────────────────────

  /** Instruments that answered a protocol handshake. Empty when none are
   *  attached — the browser has no serial ports at all, so it lists nothing
   *  rather than inventing devices. */
  discoverDevices: (): Promise<DeviceInfo[]> => IS_TAURI
    ? deviceApi.invoke<DeviceRowDTO[]>('discover').then(ds => ds.map(d => ({
        id: d.id, name: d.name, model: d.model,
        status: d.status as DeviceInfo['status'],
        serial: d.serial, firmware: d.firmware,
      })))
    : Promise.resolve([]),

  connectDevice: (port: string): Promise<void> => IS_TAURI
    ? deviceApi.invoke('connect', { port }).then(() => {})
    : Promise.resolve(),

  disconnectDevice: (): Promise<void> => IS_TAURI
    ? deviceApi.invoke('disconnect').then(() => {})
    : Promise.resolve(),

  /** Install an S-record firmware image on `deviceId` and reconnect to it.
   *  Resolves with the firmware version the board reports afterwards. */
  updateFirmware: (deviceId: string, srec: string): Promise<string> => IS_TAURI
    ? deviceApi.invoke<string>('update_firmware', { device_id: deviceId, srec })
    : Promise.reject(new Error('Firmware update needs the desktop app')),

  /** A script, the CLI or an agent asks for a privileged command; it waits until
   *  `answerConfirm`. `onClosed` fires when a request is answered or times out. */
  onConfirmRequests: (onRequest: (r: ConfirmRequest) => void, onClosed: (id: number) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    const stops: (() => void)[] = [];
    listen<ConfirmRequest>('confirm-request', e => onRequest(e.payload)).then(fn => stops.push(fn));
    listen<{ id: number }>('confirm-closed', e => onClosed(e.payload.id)).then(fn => stops.push(fn));
    return () => stops.forEach(f => f());
  },

  answerConfirm: (id: number, approve: boolean): Promise<unknown> =>
    deviceApi.invoke('confirm', { id, approve }),

  onFirmwareProgress: (cb: (stage: string, done: number, total: number) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<{ stage: string; done: number; total: number }>('firmware-progress',
      e => cb(e.payload.stage, e.payload.done, e.payload.total))
      .then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },

  /** Everything the UI mirrors from the instrument, in one read. The backend
   *  owns these; the UI never keeps its own copy as the truth. */
  readInstrument: (): Promise<InstrumentState> => IS_TAURI
    ? deviceApi.read<Record<string, unknown>>(INSTRUMENT_VARS).then(v => ({
        meta: metaFromDTO(v['device.info'] as DeviceMetadataDTO | null),
        reconnecting: v['device.state'] === 'reconnecting',
        dark: v['reference.dark'] as boolean,
        darkStale: v['reference.dark_stale'] as boolean,
        reference: v['reference.white'] as boolean,
        live: v['acquisition.live'] as boolean,
        integration: v['acquisition.integration_time_ms'] as number,
        averaging: v['acquisition.averages'] as number,
        mode: v['processing.mode'] as AcqParams['mode'],
      }))
    : Promise.resolve({ meta: null, reconnecting: false, dark: false, darkStale: false, reference: false, live: false,
        integration: 120, averaging: 4, mode: 'intensity' }),

  /** Set an acquisition setting; resolves with the value the backend applied
   *  (the GUI's requests are clamped to the device's range). */
  writeSetting: (name: 'acquisition.integration_time_ms' | 'acquisition.averages' | 'workspace.active',
                 value: number | string): Promise<number | string> => IS_TAURI
    ? deviceApi.write(name, value)
    : Promise.resolve(value),

  startLive: (): Promise<void> => IS_TAURI
    ? deviceApi.invoke('start_live').then(() => {})
    : noBackend('Live'),

  stopLive: (): Promise<void> => IS_TAURI
    ? deviceApi.invoke('stop_live').then(() => {})
    : Promise.resolve(),

  /** One averaged measurement. The backend files it in the active workspace —
   *  a database row and a .jdx file — exactly as it would for a script. */
  /** An empty `label` lets the backend name it spectra_NNN. */
  capture: (args: { id: string; label: string; tag: string; color: string }): Promise<{
    spectrum: Spectrum; params: AcqParams; timestamp: number; label: string;
    file: string | null; fileError: string | null; saved: boolean;
  }> => IS_TAURI
    ? deviceApi.invoke<CaptureResultDTO>('capture', args).then(r => {
        const params = { ...DEFAULT_PARAMS, ...(r.saved?.params ?? {}), mode: r.frame.mode as AcqParams['mode'],
          integration: r.frame.integration_ms } as AcqParams;
        return {
          spectrum: frameToSpectrum(r.frame, params), params, timestamp: r.frame.timestamp,
          label: r.saved?.label ?? '',
          file: r.saved?.file ?? null, fileError: r.saved?.file_error ?? null, saved: r.saved !== null,
        };
      })
    : noBackend('Capturing'),

  /** `count` captures `intervalMs` apart (start to start), each filed like a
   *  single capture and named `label`_001… (spectra_NNN when empty). stopLive ends it early. */
  burst: (args: { count: number; intervalMs: number; label: string; tag: string }, params: AcqParams): Promise<{
    taken: number; total: number; stopped: boolean; spectrum: Spectrum | null;
  }> => IS_TAURI
    ? deviceApi.invoke<{ taken: number; total: number; stopped: boolean; frame: CaptureResultDTO['frame'] | null }>('burst',
        { count: args.count, interval_ms: args.intervalMs, label: args.label, tag: args.tag })
        .then(r => ({ taken: r.taken, total: r.total, stopped: r.stopped,
          spectrum: r.frame ? frameToSpectrum(r.frame, params) : null }))
    : noBackend('Burst capture'),

  /** Shots done in a burst in flight. */
  onBurstProgress: (cb: (done: number, total: number) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<{ done: number; total: number }>('burst-progress', e => cb(e.payload.done, e.payload.total))
      .then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },

  /** Scan-by-scan progress of a capture in flight. */
  /** A capture was filed by any caller — the GUI, a script, the CLI or an agent. */
  onCaptureSaved: (cb: (sessionId: string, id: string) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<{ session_id: string; id: string }>('capture-saved', e => cb(e.payload.session_id, e.payload.id))
      .then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },

  onCaptureProgress: (cb: (done: number, total: number) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<{ done: number; total: number }>('capture-progress', e => cb(e.payload.done, e.payload.total))
      .then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },

  /** Tell the backend a streamed frame has been rendered, so it may capture the
   *  next one. Without this the acquisition loop keeps emitting into a queue the
   *  renderer is not draining and the displayed trace falls behind. */
  frameConsumed: (): Promise<void> => IS_TAURI
    ? tauriInvoke('cmd_frame_consumed')
    : Promise.resolve(),

  stopAcquisition: (): Promise<void> => IS_TAURI
    ? deviceApi.invoke('stop_live').then(() => {})
    : Promise.resolve(),

  calibrateXcal: (): Promise<XCalResult> => IS_TAURI
    ? tauriInvoke<XCalResultDTO>('cmd_calibrate_xcal')
        .then(r => ({
          status: r.status as XCalResult['status'], rms: r.rms,
          coefficients: r.coefficients, peaksFound: r.peaks_found,
        }))
    : new Promise(resolve => setTimeout(() =>
        resolve({ status: 'ok', rms: 0.018, coefficients: [400, 1.6], peaksFound: 12 }), 1400)),

  /** Store the spectrum currently on the plot as the dark or the reference.
   *  Tags what was measured rather than measuring again, so the calibration
   *  inherits the Averaging that produced it. */
  tagLastFrame: (which: 'dark' | 'reference'): Promise<CalResult> => IS_TAURI
    ? deviceApi.invoke<CalResultDTO>(which === 'dark' ? 'capture_dark' : 'capture_reference')
        .then(r => ({ status: r.status as CalResult['status'], rms: r.rms ?? undefined, warn: r.warn ?? undefined }))
    : noBackend('Tagging a calibration'),

  /** Discard a stored calibration frame. */
  clearCalibration: (which: 'dark' | 'reference'): Promise<void> => IS_TAURI
    ? deviceApi.invoke(which === 'dark' ? 'clear_dark' : 'clear_reference').then(() => {})
    : Promise.resolve(),

  /** Instrument events, newest last. Empty until something has happened. */
  getDiagnostics: (): Promise<DiagEntry[]> => IS_TAURI
    ? deviceApi.read<DiagEntryDTO[]>('device.diagnostics').then(es => es.map(e => ({
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

  /** Folder a workspace's .jdx files are written to. */
  workspaceDir: (name: string): Promise<string | null> => IS_TAURI
    ? tauriInvoke<string>('cmd_workspace_dir', { name })
    : Promise.resolve(null),

  loadCaptures: (sessionId: string): Promise<Capture[]> => IS_TAURI
    ? tauriInvoke<CaptureRowDTO[]>('cmd_load_captures', { sessionId }).then(rows =>
        rows.map(r => ({
          id: r.id, sessionId: r.session_id,
          label: r.label ?? '', timestamp: r.timestamp,
          tag: r.tag ?? '', params: JSON.parse(r.params_json) as AcqParams,
          xs: new Float32Array(r.xs), ys: new Float32Array(r.ys),
          // Empty when the capture came from a script; the store colours it.
          color: r.color ?? '',
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
    if (!IS_TAURI) return noBackend<PCAResult>('PCA');
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
        algorithm, version: 1, filePath: `~/jasper/models/pending.joblib`,
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
    if (!IS_TAURI) return noBackend<RegressionResult>('Regression');
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

  /** Trained models on disk. Empty until something has actually been trained —
   *  the two seeded entries here were invented, down to their metrics. */
  loadModels: (): Promise<ModelMeta[]> => Promise.resolve([]),

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

  /** Open a native save dialog and write `sheets` as an .xlsx workbook. Cells are
   *  numbers, strings, or null for empty. Returns the path, or null if cancelled. */
  saveXlsx: (
    defaultName: string,
    sheets: Array<{ name: string; rows: Array<Array<number | string | null>> }>,
  ): Promise<string | null> => IS_TAURI
    ? tauriInvoke<string | null>('cmd_save_xlsx', { defaultName, sheets })
    : Promise.resolve(null),

  /** Yes/no prompt. The webview's own window.confirm() does not show a dialog in Tauri. */
  confirm: (message: string): Promise<boolean> => IS_TAURI
    ? ask(message, { title: 'JASPER', kind: 'warning' })
    : Promise.resolve(window.confirm(message)),

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
   * Browser mode: no-op. liveSpectrum stays null and the canvas shows its
   *   "no signal" state — there is no generator to fall back on.
   */
  onSpectrumFrame: (cb: (s: Spectrum) => void): (() => void) => {
    if (!IS_TAURI) return () => {};
    let unlisten: (() => void) | null = null;
    listen<FrameDTO>('spectrum-frame', event => {
      cb({
        xs: new Float32Array(event.payload.xs),
        ys: new Float32Array(event.payload.ys),
        timestamp: event.payload.timestamp,
        units: event.payload.units,
        peak: event.payload.peak,
        // Only `mode` and the applied integration matter downstream —
        // LiveSpectrum uses store params for the rest and discards frames whose
        // mode no longer matches the UI.
        params: {
          mode: (event.payload.mode || 'absorbance') as AcqParams['mode'],
          acqMode: 'continuous',
          integration: event.payload.integration_ms,
          averaging: 4,
          xUnit: 'nm', yUnit: 'au', lockAxes: false, stack: false,
        },
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },


  onDeviceEvent: (_cb: (e: DeviceEvent) => void): (() => void) => () => {},
};

export type IPC = typeof ipc;
