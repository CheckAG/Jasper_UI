import { useRef, useEffect, useState } from 'react';
import type { AcqParams } from '../lib/types';

interface Series {
  ys:      Float32Array;
  color:   string;
  width?:  number;
  dashed?: boolean;
  label?:  string;
}

interface StaticChartProps {
  xs:       Float32Array;         // shared x-axis (nm)
  series:   Series[];
  params?:  Pick<AcqParams, 'xUnit' | 'yUnit' | 'mode'>;
  height?:  number;
}

export function StaticChart({ xs, series, height = 260 }: StaticChartProps) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  // Measure the wrapper (never the canvas) — decouples sizing from data redraws,
  // which prevents the canvas-feeds-its-own-width shrink loop.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setWidth(Math.max(120, Math.floor(e.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw — runs when data or measured width changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || xs.length === 0 || series.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const W = width, H = height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const xPad = 44, yPadTop = 16, yPadBot = 24;
    const allYs = series.flatMap(s => Array.from(s.ys));
    const yMin = Math.min(...allYs), yMax = Math.max(...allYs);
    const yRange = yMax - yMin || 1;
    const xMin = xs[0], xMax = xs[xs.length - 1];

    const xPx = (v: number) => xPad + (v - xMin) / (xMax - xMin) * (W - xPad - 14);
    const yPx = (v: number) => yPadTop + (1 - (v - yMin) / yRange) * (H - yPadTop - yPadBot);

    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(15,17,21,0.06)'; ctx.lineWidth = 1;
    ctx.font = '10px "Geist Mono", monospace'; ctx.fillStyle = '#7a808a';
    [400, 800, 1200, 1600, 2000].forEach(x => {
      if (x < xMin || x > xMax) return;
      const px = xPx(x);
      ctx.beginPath(); ctx.moveTo(px, yPadTop); ctx.lineTo(px, H - yPadBot); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(String(x), px, H - 8);
    });
    for (let i = 0; i <= 4; i++) {
      const py = yPadTop + (i / 4) * (H - yPadTop - yPadBot);
      ctx.beginPath(); ctx.moveTo(xPad, py); ctx.lineTo(W - 14, py); ctx.stroke();
      const val = yMax - i * yRange / 4;
      ctx.textAlign = 'right'; ctx.fillText(val.toFixed(2), xPad - 4, py + 3);
    }

    // Series
    series.forEach(s => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.5;
      if (s.dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const px = xPx(xs[i]), py = yPx(s.ys[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }, [xs, series, height, width]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%', height, borderRadius: 10,
          border: '1px solid var(--line)', background: 'var(--paper)', display: 'block',
        }}
      />
    </div>
  );
}
