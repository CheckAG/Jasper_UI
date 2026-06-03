import { useState } from 'react';
import { useUIStore }      from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { useAnalyzeStore } from '../../store/analyzeStore';
import { ipc }             from '../../lib/ipc';
import { buildExport }     from '../../lib/exporters';
import { Button }          from '../design/Button';
import type { ExportFormat } from '../../lib/types';

const FORMATS: Array<{ id: ExportFormat; name: string; ext: string; desc: string }> = [
  { id: 'jcamp-dx',    name: 'JCAMP-DX',  ext: '.dx',  desc: 'IUPAC standard, round-trip lossless with method sidecar' },
  { id: 'csv-xy',      name: 'CSV (x/y)', ext: '.csv', desc: 'Wavelength + intensity column per capture' },
  { id: 'csv-matrix',  name: 'CSV matrix',ext: '.csv', desc: 'Samples × wavelengths matrix format' },
  { id: 'svg',         name: 'SVG figure',ext: '.svg', desc: 'Print-grade vector figure, publication ready' },
];

export function ExportDialog() {
  const [format, setFormat] = useState<ExportFormat>('jcamp-dx');
  const [metadata, setMetadata] = useState(true);
  const [pipeline, setPipeline] = useState(true);
  const [selected, setSelected] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { setExportOpen } = useUIStore();
  const { activeId, captures, activeSession } = useSessionStore();
  const pipelineNodes = useAnalyzeStore(s => s.pipeline);

  async function doExport() {
    setExporting(true);
    setError(null);
    try {
      const session = activeSession();
      const caps = selected ? captures.slice(-1) : captures;  // (selection UI is future work)
      if (caps.length === 0) { setError('No captures to export'); setExporting(false); return; }

      const { filename, content } = await buildExport(
        format,
        session?.name ?? 'jasper',
        caps,
        pipeline ? pipelineNodes : undefined,
      );

      const path = await ipc.saveExport(filename, content);
      if (path) {
        setResult(path);
        await ipc.saveAudit({
          id: Math.random().toString(36).slice(2),
          sessionId: activeId,
          action: 'export',
          actor: session?.operator || 'local',
          timestamp: Date.now(),
          detail: JSON.stringify({ format, count: caps.length, path, includeMetadata: metadata }),
        });
      } else {
        setError('Export cancelled');
      }
    } catch (e) {
      setError(String(e));
    }
    setExporting(false);
  }

  return (
    <div onClick={() => setExportOpen(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, background: 'var(--paper)', border: '1px solid var(--line)',
        borderRadius: 14, boxShadow: '0 30px 80px -20px rgba(15,17,21,0.45)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Export</h4>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            Export spectra and metadata
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 16 }}>
          {FORMATS.map(f => (
            <button key={f.id} onClick={() => setFormat(f.id)} style={{
              textAlign: 'left', cursor: 'pointer', padding: 12,
              border: `1px solid ${format === f.id ? 'var(--signal)' : 'var(--line)'}`,
              borderRadius: 10,
              background: format === f.id ? 'var(--signal-soft)' : 'var(--bg)',
              color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 6,
              fontFamily: 'var(--font-sans)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{f.ext}</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{f.desc}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 16px' }}>
          {[
            { label: 'Include metadata & audit trail', val: metadata, set: setMetadata },
            { label: 'Include pre-processing pipeline', val: pipeline, set: setPipeline },
            { label: 'Selected captures only', val: selected, set: setSelected },
          ].map(opt => (
            <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={opt.val} onChange={e => opt.set(e.target.checked)}
                style={{ accentColor: 'var(--signal)', width: 14, height: 14 }} />
              {opt.label}
            </label>
          ))}
        </div>

        {result && (
          <div style={{ margin: '0 16px 12px', padding: '8px 12px', borderRadius: 8,
            background: 'rgba(31,157,85,0.08)', border: '1px solid rgba(31,157,85,0.3)',
            fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-ok)',
            wordBreak: 'break-all' }}>
            ✓ Exported to: {result}
          </div>
        )}
        {error && (
          <div style={{ margin: '0 16px 12px', padding: '8px 12px', borderRadius: 8,
            background: 'rgba(192,50,45,0.08)', border: '1px solid rgba(192,50,45,0.3)',
            fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-alarm)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          <Button variant="ghost" onClick={() => setExportOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={doExport} disabled={exporting}>
            {exporting ? 'Exporting…' : `Export ${FORMATS.find(f => f.id === format)?.ext}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
