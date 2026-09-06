import { useRef, useEffect, useState } from 'react';
import type { AcqParams, Capture, CursorState, Spectrum } from '../lib/types';
import { generateSpectrum } from '../lib/mockDriver';

// ── Unit conversion helpers ───────────────────────────────────────────────────

function xConv(nm: number, unit: AcqParams['xUnit']): number {
  if (unit === 'um') return nm / 1000;
  if (unit === 'wn') return 1e7 / nm;
  return nm;
}
function xAxisLabel(unit: AcqParams['xUnit']): string {
  return { nm: 'Wavelength · nm', um: 'Wavelength · µm', wn: 'Wavenumber · cm⁻¹', px: 'Detector pixel' }[unit];
}
function xTickFmt(
  nm: number, unit: AcqParams['xUnit'],
  xMin: number, xMax: number, nPoints: number,
): string {
  if (unit === 'px') return String(Math.round((nm - xMin) / (xMax - xMin) * (nPoints - 1)));
  const v = xConv(nm, unit);
  if (unit === 'um') return v.toFixed(2);
  if (unit === 'wn') return v.toFixed(0);
  return String(Math.round(v));
}

/** Largest of 1/2/5 × 10ⁿ not exceeding ~raw — for stable, readable axis steps. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  const r = raw / mag;
  return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * mag;
}
function yLabel(mode: AcqParams['mode'], yUnit: AcqParams['yUnit'], units?: string): string {
  // Backend-pipeline frames say what their ys actually are — label honestly,
  // e.g. raw counts shown while absorbance mode awaits dark/reference cal.
  if (units === 'counts')   return 'Counts · raw (no dark/ref cal)';
  if (units === 'counts_d') return 'Counts · dark-subtracted';
  if (units === 'abs')      return 'Absorbance';
  if (units === 'ratio')    return mode === 'reflectance' ? 'Reflectance · 0–1' : 'Transmittance · 0–1';
  const byUnit: Partial<Record<AcqParams['yUnit'], string>> = {
    au: 'Intensity · a.u.', abs: 'Absorbance', pct: 'Reflectance · 0–100 %',
    counts: 'Counts', cps: 'Counts / sec', logr: 'log(1/R)',
  };
  if (byUnit[yUnit]) return byUnit[yUnit]!;
  if (mode === 'absorbance')    return 'Absorbance · a.u.';
  if (mode === 'reflectance')   return 'Reflectance · 0–1';
  if (mode === 'transmittance') return 'Transmittance · 0–1';
  if (mode === 'intensity')     return 'Intensity · a.u.';
  if (mode === 'counts')        return 'Counts';
  return 'Irradiance · W·m⁻²·nm⁻¹';
}
function yRange(mode: AcqParams['mode']): [number, number] {
  if (mode === 'absorbance')    return [0, 0.95];
  if (mode === 'reflectance')   return [0.45, 1.0];
  if (mode === 'transmittance') return [0.55, 1.0];
  return [0.2, 0.9];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface LiveSpectrumProps {
  params:        AcqParams;
  captures:      Capture[];
  theme:         'light';
  liveSpectrum?: Spectrum | null; // from acqStore (real stream); null → local fallback
  onCursor?:     (c: CursorState | null) => void;
  paused:        boolean;
}

export function LiveSpectrum({
  params, captures, liveSpectrum, onCursor, paused,
}: LiveSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });

  // Latest-value refs — the imperative rAF loop reads these so it never needs
  // to be torn down and rebuilt when props change (only on resize).
  const paramsRef   = useRef(params);   paramsRef.current   = params;
  const capturesRef = useRef(captures); capturesRef.current = captures;
  const liveRef     = useRef(liveSpectrum); liveRef.current  = liveSpectrum ?? null;
  const pausedRef   = useRef(paused);   pausedRef.current   = paused;
  const onCursorRef = useRef(onCursor); onCursorRef.current = onCursor;
  const cursorXRef  = useRef<number | null>(null);
  const localTRef   = useRef(0);
  const lastRealRef = useRef<Spectrum | null>(null); // last streamed frame, for pause

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const r = e.contentRect;
        setSize({ w: Math.max(200, r.width), h: Math.max(150, r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Drawing loop — mounted once per size, reads everything from refs ───────
  useEffect(() => {
    let raf: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const xPad = 48, yPadTop = 20, yPadBot = 28;
    let W = size.w, H = size.h;

    // Pull chart colours from the theme tokens so the canvas matches the rest
    // of the UI (and re-themes automatically with tokens.css).
    const css = getComputedStyle(document.documentElement);
    const tok = (name: string, fallback: string) => (css.getPropertyValue(name).trim() || fallback);
    const muted      = tok('--muted', '#7a808a');
    const inkRgb     = tok('--ink-rgb', '15,17,21');
    const grid       = `rgba(${inkRgb},0.05)`;
    const gridStrong = `rgba(${inkRgb},0.10)`;
    const accentLive = tok('--signal', '#1f5dff');
    const accentPrev = `rgba(${inkRgb},0.18)`;

    function fit() {
      const host = canvas!.parentElement!;
      const w = Math.max(200, host.clientWidth);
      const h = Math.max(150, host.clientHeight);
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas!.width !== pw || canvas!.height !== ph) {
        canvas!.width = pw; canvas!.height = ph;
        canvas!.style.width = w + 'px'; canvas!.style.height = h + 'px';
      }
      W = w; H = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawFrame() {
      fit();

      // Read latest props from refs
      const params   = paramsRef.current;
      const captures = capturesRef.current;
      const live0    = liveRef.current;
      const paused   = pausedRef.current;
      const cursorX  = cursorXRef.current;

      // Use the streamed frame only if it matches the current mode; a frame left
      // over from the previous mode (during a switch) is discarded in favour of
      // the param-coherent local generator — no flicker between two shapes.
      const freshFrame = live0 && live0.params.mode === params.mode ? live0 : null;
      if (freshFrame) lastRealRef.current = freshFrame;
      // Pause freezes the last streamed frame instead of swapping to the mock
      const heldFrame =
        paused && lastRealRef.current?.params.mode === params.mode ? lastRealRef.current : null;
      const streamed = paused ? heldFrame : freshFrame;
      const live = streamed ?? generateSpectrum(params, localTRef.current);
      const usingLocalGen = !streamed;
      if (!paused) localTRef.current += 0.016;

      // Axes derive from the data on screen — no hard-coded instrument
      // geometry (real device: 1024 px / 200–1000 nm; mock: 320 px / 400–2000).
      let xMin = live.xs[0], xMax = live.xs[live.xs.length - 1];
      for (const cap of captures) {
        if (cap.xs.length) {
          xMin = Math.min(xMin, cap.xs[0]);
          xMax = Math.max(xMax, cap.xs[cap.xs.length - 1]);
        }
      }
      if (!(xMax > xMin)) { xMin = 400; xMax = 2000; }

      // Mock-styled data (local generator or mock driver, empty units) is
      // authored for the fixed per-mode ranges; backend-pipeline frames carry
      // units (counts/abs/ratio) — autoscale to the data, snapped to a nice
      // step so frame-to-frame noise doesn't make the axis jitter.
      let [yMin, yMax] = yRange(params.mode);
      if (live.units) {
        let lo = Infinity, hi = -Infinity;
        const scanYs = (ys: ArrayLike<number>) => {
          for (let i = 0; i < ys.length; i++) {
            const v = ys[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        };
        scanYs(live.ys);
        captures.forEach(c => scanYs(c.ys));
        if (isFinite(lo) && isFinite(hi)) {
          const pad  = (hi - lo) * 0.08 || Math.max(1, Math.abs(hi) * 0.05);
          const step = niceStep(((hi - lo) + 2 * pad) / 5);
          yMin = Math.floor((lo - pad) / step) * step;
          yMax = Math.ceil((hi + pad) / step) * step;
        }
      }

      const xPx = (x: number) => xPad + (x - xMin) / (xMax - xMin) * (W - xPad - 14);
      const yPx = (y: number) => yPadTop + (1 - (y - yMin) / (yMax - yMin)) * (H - yPadTop - yPadBot);

      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.lineWidth = 1;
      ctx.font = '11px "Geist Mono", ui-monospace, monospace';
      ctx.fillStyle = muted;
      const xStep = niceStep((xMax - xMin) / 8);
      const xTicks: number[] = [];
      for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) xTicks.push(x);
      xTicks.forEach((x, i) => {
        const px = xPx(x);
        ctx.beginPath(); ctx.moveTo(px, yPadTop); ctx.lineTo(px, H - yPadBot);
        ctx.strokeStyle = i % 2 === 0 ? gridStrong : grid; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(xTickFmt(x, params.xUnit, xMin, xMax, live.xs.length), px, H - 10);
      });
      const yFmt = (v: number) => (yMax - yMin) >= 20 ? String(Math.round(v)) : v.toFixed(2);
      for (let i = 0; i <= 5; i++) {
        const yy = yMin + (yMax - yMin) * i / 5;
        const py = yPx(yy);
        ctx.beginPath(); ctx.moveTo(xPad, py); ctx.lineTo(W - 14, py);
        ctx.strokeStyle = (i === 0 || i === 5) ? gridStrong : grid; ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(yFmt(yy), xPad - 6, py + 3);
      }

      // Axis labels
      ctx.fillStyle = muted; ctx.textAlign = 'left';
      ctx.fillText(yLabel(params.mode, params.yUnit, live.units), xPad, 14);
      ctx.textAlign = 'right';
      ctx.fillText(xAxisLabel(params.xUnit), W - 14, 14);

      // Overlaid captures = the ones the user has selected in the rail.
      // Color-coded; in stack mode each is offset vertically with a label.
      const overlay = captures;
      const stackSpan = H - yPadTop - yPadBot;
      overlay.forEach((cap, idx) => {
        const stackOff = params.stack ? -((idx + 1) * stackSpan) / (overlay.length + 2) : 0;
        ctx.strokeStyle = cap.color || accentPrev;
        ctx.globalAlpha = params.stack ? 0.95 : 0.85;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < cap.xs.length; i++) {
          const px = xPx(cap.xs[i]), py = yPx(cap.ys[i]) + stackOff;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (params.stack) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = cap.color;
          ctx.textAlign = 'left';
          ctx.fillText(cap.label, xPad + 4, yPx(cap.ys[0]) + stackOff - 4);
        }
      });
      ctx.globalAlpha = 1;

      // Averaging ghosts (local generator only — real averaging is upstream)
      if (usingLocalGen && params.averaging > 1) {
        for (let k = 0; k < Math.min(params.averaging - 1, 3); k++) {
          const ghost = generateSpectrum(params, localTRef.current, k + 1);
          ctx.strokeStyle = accentLive; ctx.globalAlpha = 0.1; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < ghost.xs.length; i++) {
            const px = xPx(ghost.xs[i]), py = yPx(ghost.ys[i]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Bold live line
      ctx.strokeStyle = accentLive; ctx.lineWidth = 1.8; ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < live.xs.length; i++) {
        const px = xPx(live.xs[i]), py = yPx(live.ys[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Cursor crosshair
      if (cursorX !== null && cursorX > xPad && cursorX < W - 14) {
        const xVal = xMin + (cursorX - xPad) / (W - xPad - 14) * (xMax - xMin);
        const idx  = Math.round((xVal - xMin) / (xMax - xMin) * (live.xs.length - 1));
        const xs = live.xs[idx], ys = live.ys[idx];
        const px = xPx(xs), py = yPx(ys);
        ctx.strokeStyle = `rgba(${inkRgb},0.28)`; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, yPadTop); ctx.lineTo(px, H - yPadBot);
        ctx.moveTo(xPad, py); ctx.lineTo(W - 14, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = accentLive;
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = tok('--paper', '#fff');
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
        onCursorRef.current?.({
          x: xs, y: ys,
          snr: Math.round(60 + 800 * Math.sqrt(params.integration / 50) * Math.sqrt(params.averaging)),
        });
      }

      raf = requestAnimationFrame(drawFrame);
    }
    fit();
    drawFrame();
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1, minHeight: 0, borderRadius: 14,
        background: 'var(--paper)', border: '1px solid var(--line)',
        position: 'relative', overflow: 'hidden', cursor: 'crosshair',
      }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect();
        cursorXRef.current = e.clientX - r.left;
      }}
      onMouseLeave={() => { cursorXRef.current = null; onCursor?.(null); }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
