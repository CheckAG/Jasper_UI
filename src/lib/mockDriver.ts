// ============================================================
// JASPER — Mock spectrum driver
// Ported from live-spectrum.jsx (CheckAg prototype)
// Replaced by Tauri IPC in Phase 4.
// ============================================================

import type { AcqParams, Spectrum, Telemetry, DeviceInfo } from './types';

type BandDef = [number, number, number]; // [center_nm, width_nm, height]

function bandsFor(mode: AcqParams['mode']): BandDef[] {
  if (mode === 'reflectance') {
    return [[950,80,-0.22],[1200,100,-0.28],[1450,130,-0.40],[1900,130,-0.38],[1680,60,-0.10]];
  }
  if (mode === 'transmittance') {
    return [[950,80,-0.18],[1200,100,-0.25],[1450,130,-0.35],[1900,130,-0.35]];
  }
  if (mode === 'intensity' || mode === 'counts' || mode === 'irradiance') {
    return [[800,220,0.18],[950,80,-0.16],[1200,100,-0.22],[1450,130,-0.30],[1900,130,-0.30]];
  }
  // absorbance (default)
  return [[950,70,0.18],[1200,90,0.30],[1450,120,0.48],[1680,60,0.12],[1900,110,0.40]];
}

function baselineFor(mode: AcqParams['mode']): number {
  if (mode === 'reflectance')   return 0.92;
  if (mode === 'transmittance') return 0.95;
  if (mode === 'intensity' || mode === 'counts' || mode === 'irradiance') return 0.55;
  return 0.04;
}

export function generateSpectrum(params: AcqParams, t: number, seedOffset = 0): Spectrum {
  const N = 320;
  const xMin = 400, xMax = 2000;
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  const bands = bandsFor(params.mode);
  const base = baselineFor(params.mode);
  const noiseLevel =
    0.012 * Math.sqrt(50 / Math.max(5, params.integration)) /
    Math.sqrt(Math.max(1, params.averaging));

  for (let i = 0; i < N; i++) {
    const x = xMin + (xMax - xMin) * (i / (N - 1));
    let y = base;
    for (const [c, w, h] of bands) {
      y += h * Math.exp(-Math.pow((x - c) / w, 2));
    }
    y += 0.006 * Math.sin((x + t * 40 + seedOffset * 137) / 70);
    y += 0.004 * Math.sin((x - t * 25) / 31 + seedOffset);
    y += (Math.random() - 0.5) * noiseLevel;
    xs[i] = x;
    ys[i] = y;
  }
  return { xs, ys, timestamp: Date.now(), params };
}

export function sampleCapture(params: AcqParams, t: number): Spectrum {
  return generateSpectrum(params, t);
}

export function getMockTelemetry(): Telemetry {
  return {
    deviceId: 'SPEC-A4',
    tempC: 42.1 + (Math.random() - 0.5) * 0.4,
    lampHours: 1280,
    driftSigma: 0.42,
    headroom: 87,
    queueDepth: 0,
    timestamp: Date.now(),
  };
}

export function getMockDevices(): DeviceInfo[] {
  return [
    { id: 'SPEC-A4', name: 'SPEC-A4', model: 'JASPER-NIR-1', status: 'connected', tempC: 42.1 },
    { id: 'SPEC-B2', name: 'SPEC-B2', model: 'JASPER-NIR-1', status: 'disconnected', tempC: 38.4 },
  ];
}
