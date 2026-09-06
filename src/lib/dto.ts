// ============================================================
// JASPER — wire DTOs
// Snake_case payload shapes crossing the IPC boundary:
//   Rust Tauri commands  → *RowDTO / *DTO
//   Python sidecar JSON  → sidecar *DTO
// These are the *only* place `any`-ish wire shapes live; ipc.ts maps them
// into the camelCase domain types from types.ts.
// ============================================================

// ── Rust: instrument ──────────────────────────────────────────────────────────

export interface DeviceRowDTO {
  id:       string;
  name:     string;
  model:    string;
  status:   string;
  serial:   string;
  firmware: string;
}

/** Mirrors `DiagEntry` in src-tauri/src/instrument/driver.rs. */
export interface DiagEntryDTO {
  id:       string;
  ts:       number;
  severity: string;
  message:  string;
}

/** Mirrors `DeviceMetadata` in src-tauri/src/instrument/driver.rs. */
export interface DeviceMetadataDTO {
  port:             string;
  manufacturer:     string;
  model:            string;
  serial:           string;
  firmware:         string;
  protocol_version: number;
  pixels:           number;
  integ_min_ms:     number;
  integ_max_ms:     number;
  max_intensity:    number;
  sensor:           string;
  last_seq:         number;
  dropped_frames:   number;
  last_capture_ms:  number;
  timestamp:        number;
}

export interface FrameDTO {
  xs:        number[];
  ys:        number[];
  mode:      string;
  /** "" mock-styled · "counts" raw · "counts_d" dark-subtracted · "ratio" · "abs" */
  units:     string;
  timestamp: number;
}

export interface CalResultDTO {
  status: string;
  rms?:   number | null;
  warn?:  string | null;
}

export interface XCalResultDTO {
  status:       string;
  rms:          number;
  coefficients: number[];
  peaks_found:  number;
}

// ── Rust: storage ─────────────────────────────────────────────────────────────

export interface SessionRowDTO {
  id:             string;
  name:           string;
  operator?:      string | null;
  device?:        string | null;
  method_id?:     string | null;
  created_at:     number;
  status:         string;
  capture_count?: number;
}

export interface CaptureRowDTO {
  id:          string;
  session_id:  string;
  label?:      string | null;
  timestamp:   number;
  tag?:        string | null;
  params_json: string;
  xs:          number[];
  ys:          number[];
  color?:      string | null;
}

// ── Python sidecar: pipeline / plugins ────────────────────────────────────────

export interface ParamDescDTO {
  label:    string;
  default:  number;
  type?:    string;
  [extra:   string]: unknown;
}

export interface ManifestNodeDTO {
  kind:   string;
  name:   string;
  family: string;
  code:   string;
  params: Record<string, ParamDescDTO>;
}

export interface NodeOutDTO {
  id:              string;
  code:            string;
  enabled:         boolean;
  params:          Record<string, number>;
  output_preview?: number[];
}

export interface PipelineResultDTO {
  nodes:       NodeOutDTO[];
  final:       number[];
  duration_ms: number;
}

export interface ReloadPluginsDTO {
  loaded:   number;
  dir:      string;
  manifest: ManifestNodeDTO[];
}

// ── Python sidecar: chemometrics ──────────────────────────────────────────────

export interface PCAResultDTO {
  scores:             number[][];
  loadings:           number[][];
  explained_variance: number[];
  labels:             string[];
}

export interface TrainResultDTO {
  model_id:      string;
  algorithm:     string;
  file_path:     string;
  n_components?: number;
  rmsep?:        number;
  r2?:           number;
  bias?:         number;
  accuracy?:     number;
  predicted?:    number[];
  actual?:       number[];
}

export interface PredictionResultDTO {
  value:     number;
  unit?:     string;
  ci95:      [number, number];
  top_bands: Array<{ nm: number; contribution: number }>;
}

export interface MixtureResultDTO {
  components: Array<{ id: string; name: string; fraction: number; color: string }>;
  residual:   number;
}
