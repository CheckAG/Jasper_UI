// ============================================================
// JASPER — export format builders
// CSV + SVG are built in TS; JCAMP-DX is rendered by the Python
// sidecar (single source of truth for the format).
// ============================================================

import { ipc } from './ipc';
import type { Capture } from './types';

function safeLabel(c: Capture): string {
  return (c.tag || c.label || c.id).replace(/[,\n"]/g, ' ').trim();
}

/** CSV with a shared wavelength column and one intensity column per capture. */
export function buildCSVxy(captures: Capture[]): string {
  if (captures.length === 0) return 'wavelength_nm\n';
  const xs = captures[0].xs;
  const header = ['wavelength_nm', ...captures.map(safeLabel)].join(',');
  const rows: string[] = [header];
  for (let i = 0; i < xs.length; i++) {
    const row = [xs[i].toFixed(2), ...captures.map(c => (c.ys[i] ?? '').toString())];
    rows.push(row.join(','));
  }
  return rows.join('\n') + '\n';
}

/** CSV matrix: one row per capture, wavelengths as columns. */
export function buildCSVmatrix(captures: Capture[]): string {
  if (captures.length === 0) return 'sample\n';
  const xs = captures[0].xs;
  const header = ['sample', ...Array.from(xs, x => x.toFixed(1))].join(',');
  const rows: string[] = [header];
  for (const c of captures) {
    rows.push([safeLabel(c), ...Array.from(c.ys, y => y.toFixed(6))].join(','));
  }
  return rows.join('\n') + '\n';
}

/** Minimal print-grade SVG figure: one polyline per capture over a shared frame. */
export function buildSVG(captures: Capture[]): string {
  const W = 800, H = 400, padL = 56, padR = 16, padT = 20, padB = 36;
  if (captures.length === 0) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"/>`;

  const xs = captures[0].xs;
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const allY = captures.flatMap(c => Array.from(c.ys));
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;

  const px = (x: number) => padL + (x - xMin) / (xMax - xMin) * (W - padL - padR);
  const py = (y: number) => padT + (1 - (y - yMin) / yRange) * (H - padT - padB);

  const polylines = captures.map(c => {
    const pts = Array.from(c.xs, (x, i) => `${px(x).toFixed(1)},${py(c.ys[i]).toFixed(1)}`).join(' ');
    return `  <polyline fill="none" stroke="${c.color}" stroke-width="1.5" points="${pts}"/>`;
  }).join('\n');

  const xTicks = [400, 800, 1200, 1600, 2000].filter(x => x >= xMin && x <= xMax);
  const ticks = xTicks.map(x =>
    `  <line x1="${px(x).toFixed(1)}" y1="${H - padB}" x2="${px(x).toFixed(1)}" y2="${H - padB + 4}" stroke="#7a808a"/>` +
    `<text x="${px(x).toFixed(1)}" y="${H - padB + 16}" font-size="11" fill="#7a808a" text-anchor="middle" font-family="monospace">${x}</text>`
  ).join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">`,
    `  <rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `  <rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="none" stroke="#e7e6e3"/>`,
    `  <text x="${padL}" y="14" font-size="11" fill="#7a808a">Intensity · a.u.</text>`,
    `  <text x="${W - padR}" y="14" font-size="11" fill="#7a808a" text-anchor="end">Wavelength · nm</text>`,
    ticks,
    polylines,
    `</svg>`,
  ].join('\n');
}

/** JCAMP-DX (multi-block) via the Python sidecar. */
export async function buildJCAMP(captures: Capture[], pipeline?: unknown[]): Promise<string> {
  const spectra = captures.map(c => ({
    xs: Array.from(c.xs),
    ys: Array.from(c.ys),
    metadata: { title: c.label, owner: c.params.mode, date: new Date(c.timestamp).toISOString() },
  }));
  return ipc.writeJcampMulti(spectra, pipeline);
}

export interface ExportResult { filename: string; content: string }

const EXT: Record<string, string> = {
  'jcamp-dx': 'dx', 'csv-xy': 'csv', 'csv-matrix': 'csv', 'svg': 'svg', 'pdf': 'pdf',
};

/** Build the file content + default filename for a given format. */
export async function buildExport(
  format: string,
  sessionName: string,
  captures: Capture[],
  pipeline?: unknown[],
): Promise<ExportResult> {
  const base = sessionName.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').toLowerCase();
  const filename = `${base || 'jasper'}.${EXT[format] ?? 'txt'}`;

  let content: string;
  switch (format) {
    case 'csv-xy':     content = buildCSVxy(captures); break;
    case 'csv-matrix': content = buildCSVmatrix(captures); break;
    case 'svg':        content = buildSVG(captures); break;
    case 'jcamp-dx':   content = await buildJCAMP(captures, pipeline); break;
    default:           content = buildCSVxy(captures);
  }
  return { filename, content };
}
