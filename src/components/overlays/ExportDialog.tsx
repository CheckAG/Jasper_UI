import { useEffect, useState } from 'react';
import { useRecentStore } from '../../store/recentStore';
import { useUIStore }      from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { ipc }             from '../../lib/ipc';
import { buildExport, exportXlsx } from '../../lib/exporters';
import { Button }          from '../design/Button';
import type { ExportFormat } from '../../lib/types';

// SVG, PDF, CSV matrix and JCAMP-DX builders stay in exporters.ts; JCAMP files
// are already written per capture into the workspace folder.
const FORMATS: Array<{ id: ExportFormat; name: string; ext: string; desc: string }> = [
  { id: 'csv',  name: 'CSV',   ext: '.csv',  desc: 'Metadata as # lines, then pixel + one column per capture' },
  { id: 'xlsx', name: 'Excel', ext: '.xlsx', desc: 'Spectra sheet plus a metadata sheet' },
  { id: 'txt',  name: 'Text',  ext: '.txt',  desc: 'Same as CSV, tab-separated' },
];

export function ExportDialog() {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const { activeId, captures, selectedIds, activeSession } = useSessionStore();
  // Default to the selection when there is one: that is what is on the plot.
  const [selected, setSelected] = useState(selectedIds.length > 0);
  const [folder, setFolder] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { setExportOpen } = useUIStore();
  const sessionName = activeSession()?.name;
  useEffect(() => { if (sessionName) ipc.workspaceDir(sessionName).then(setFolder); }, [sessionName]);

  async function doExport() {
    setExporting(true);
    setError(null);
    try {
      const session = activeSession();
      const caps = selected ? captures.filter(c => selectedIds.includes(c.id)) : captures;
      if (caps.length === 0) { setError('No captures to export'); setExporting(false); return; }

      let path: string | null;
      if (format === 'xlsx') {
        path = await exportXlsx(session, caps);
      } else {
        const { filename, content } = await buildExport(format, session, caps);
        path = await ipc.saveExport(filename, content);
      }
      if (path) {
        setResult(path);
        useRecentStore.getState().addExport(path);
        await ipc.saveAudit({
          id: Math.random().toString(36).slice(2),
          sessionId: activeId,
          action: 'export',
          actor: session?.operator || 'local',
          timestamp: Date.now(),
          detail: JSON.stringify({ format, count: caps.length, path }),
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: 16 }}>
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
            { label: `Selected captures only (${selectedIds.length})`, val: selected, set: setSelected },
          ].map(opt => (
            <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={opt.val} onChange={e => opt.set(e.target.checked)}
                style={{ accentColor: 'var(--signal)', width: 14, height: 14 }} />
              {opt.label}
            </label>
          ))}
        </div>

        {folder && (
          <span style={{ display: 'block', margin: '0 16px 12px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Each capture is already saved as a JCAMP-DX file in{' '}
            <span className="mono" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{folder}</span>
          </span>
        )}
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
