// ============================================================
// JASPER — Core type definitions
// ============================================================

// --- Acquisition parameters ---
export type MeasurementMode =
  | 'absorbance' | 'reflectance' | 'transmittance'
  | 'intensity'  | 'counts'      | 'irradiance';

export type AcqMode = 'single' | 'continuous';
export type XUnit   = 'nm' | 'um' | 'wn' | 'px';
export type YUnit   = 'au' | 'abs' | 'pct' | 'counts' | 'cps' | 'logr';

export interface AcqParams {
  mode:        MeasurementMode;
  acqMode:     AcqMode;
  integration: number;   // ms
  averaging:   number;   // scan count
  lightOn:     boolean;
  lightPower:  number;   // 0–100 %
  xUnit:       XUnit;
  yUnit:       YUnit;
  lockAxes:    boolean;
  stack:       boolean;
}

// --- Spectrum data ---
export interface Spectrum {
  xs:        Float32Array;
  ys:        Float32Array;
  timestamp: number;
  params:    AcqParams;
  /** What ys actually are (from the backend pipeline):
   *  "counts" raw · "counts_d" dark-subtracted · "ratio" T/R · "abs" absorbance.
   *  Empty/undefined → mock-styled data shaped for params.mode. */
  units?:    string;
}

// --- Captured spectrum ---
export interface Capture {
  id:        string;
  sessionId: string;
  label:     string;
  timestamp: number;
  tag:       string;
  params:    AcqParams;
  xs:        Float32Array;
  ys:        Float32Array;
  color:     string;
}

// --- Calibration ---
export type CalStatus = 'ok' | 'pending' | 'fault';

export interface RefState {
  dark:      CalStatus;
  reference: CalStatus;
  xcal:      CalStatus;
  live:      boolean;
}

export interface CalibrationState {
  dark:              Float32Array | null;
  reference:         Float32Array | null;
  xcalCoefficients:  number[];
  timestamps:        Record<'dark' | 'reference' | 'xcal', number | null>;
}

// --- Cursor readout ---
export interface CursorState {
  x:   number;  // nm
  y:   number;  // intensity
  snr: number;
}

// --- Session ---
export type SessionStatus = 'active' | 'archived';

export interface Session {
  id:           string;
  name:         string;
  device:       string;
  method:       string;
  operator:     string;   // free-text "who ran this" metadata (not a role)
  createdAt:    number;
  status:       SessionStatus;
  captureCount: number;
}

// --- Workspace ---
export type WorkspaceId = 'instrument' | 'acquire' | 'analyze' | 'chemometrics';

// --- Theme / UI ---
export type Theme   = 'light' | 'dark' | 'lab';
export type Density = 'comfort' | 'standard' | 'lab';
export type Layout  = 'standard' | 'focused' | 'expanded';

// --- Pre-processing pipeline ---
export type NodeKind =
  | 'boxcar' | 'sg' | 'snv' | 'msc' | 'detrend' | 'norm' | 'deriv';

export interface PipelineNode {
  id:             string;
  kind:           NodeKind;
  name:           string;
  code:           string;          // AT_3_2 etc.
  enabled:        boolean;
  params:         Record<string, number>;
  outputPreview?: Float32Array;    // result up to this node (hover preview)
}

export interface PipelineResult {
  nodes:      PipelineNode[];
  final:      Float32Array;
  durationMs: number;
}

// --- Method (reusable acquisition + pipeline template) ---
export interface Method {
  id:        string;
  name:      string;
  params:    Partial<AcqParams>;
  pipeline:  PipelineNode[];
  createdAt: number;
  createdBy: string;
}

// --- Device ---
export interface DeviceInfo {
  id:     string;
  name:   string;
  model:  string;
  status: 'connected' | 'disconnected' | 'fault';
  tempC:  number;
}

export interface DeviceEvent {
  kind:     'connected' | 'disconnected' | 'fault' | 'drift';
  deviceId: string;
  message:  string;
  ts:       number;
}

// --- Telemetry ---
export interface Telemetry {
  deviceId:   string;
  tempC:      number;
  lampHours:  number;
  driftSigma: number;
  headroom:   number;
  queueDepth: number;
  timestamp:  number;
}

// --- Diagnostics log entry ---
export type DiagSeverity = 'info' | 'warn' | 'error';

export interface DiagEntry {
  id:        string;
  ts:        number;
  severity:  DiagSeverity;
  message:   string;
}

// --- Chemometrics ---
export type ChemAlgorithm =
  | 'pca' | 'pls' | 'pcr' | 'mlr' | 'simca' | 'knn' | 'plsda';

export interface ModelMeta {
  id:               string;
  name:             string;
  algorithm:        ChemAlgorithm;
  version:          number;
  filePath:         string;
  createdAt:        number;
  createdBy:        string;
  appliesToMethod?: string;
  metrics:          Record<string, number>;
  featureRange:     [number, number];
}

export interface PCAResult {
  scores:            number[][];
  loadings:          number[][];
  explainedVariance: number[];
  labels:            string[];
}

export interface RegressionResult {
  predicted:   number[];
  actual:      number[];
  rmsep:       number;
  r2:          number;
  bias:        number;
  nComponents: number;
}

export interface PredictionResult {
  value:    number;
  unit:     string;
  ci95:     [number, number];
  topBands: Array<{ nm: number; contribution: number }>;
}

export interface MixtureResult {
  components: Array<{ id: string; name: string; fraction: number; color: string }>;
  residual:   number;
}

// --- Audit ---
export interface AuditEntry {
  id:        string;
  sessionId: string;
  action:    string;
  actor:     string;
  timestamp: number;
  detail:    string;
}

// --- Export ---
export type ExportFormat = 'jcamp-dx' | 'csv-xy' | 'csv-matrix' | 'svg' | 'pdf';

export interface ExportOptions {
  format:           ExportFormat;
  captureIds:       string[];
  includeMetadata:  boolean;
  includePipeline:  boolean;
  includeAudit:     boolean;
}

// --- Calibration result ---
export interface CalResult {
  status: CalStatus;
  rms?:   number;
  warn?:  string;
}

export interface XCalResult {
  status:       CalStatus;
  rms:          number;
  coefficients: number[];
  peaksFound:   number;
}
