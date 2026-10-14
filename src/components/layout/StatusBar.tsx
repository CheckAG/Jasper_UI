import { useEffect, useState } from 'react';
import { useAcqStore } from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { ipc } from '../../lib/ipc';

/** Peak at or above this fraction of full scale warns of saturation (plan F6: 98%).
 *  ponytail: one fixed threshold; if the CCD visibly flattens below it on the board, lower it here. */
export const SATURATION_WARN = 0.98;

export function StatusBar() {
  const { params, cursor, fps, paused } = useAcqStore();
  const peak = useAcqStore(s => s.liveSpectrum?.peak);
  // Where this workspace's .jdx files go.
  const name = useSessionStore(s => s.activeSession()?.name);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => { if (name) ipc.workspaceDir(name).then(setFolder); }, [name]);

  return (
    <footer style={{
      display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px',
      borderTop: '1px solid var(--line)', background: 'var(--paper)',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--muted)',
      height: 'var(--row-h)', flexShrink: 0,
    }}>
      {cursor ? (
        <>
          <span>
            <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>x</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{Math.round(cursor.x)} px</b>
          </span>
          <span>
            <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>y</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cursor.y.toFixed(3)}</b>
          </span>
          <span>
            <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>SNR</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cursor.snr}</b>
          </span>
        </>
      ) : (
        <span>Hover spectrum for readout</span>
      )}
      {!paused && fps > 0 && (
        <span>
          <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>fps</span>
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{fps.toFixed(1)}</b>
        </span>
      )}
      {peak !== undefined && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          title="Brightest pixel as a share of the detector's full scale">
          <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Peak</span>
          <span style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, peak * 100)}%`,
              background: peak >= SATURATION_WARN ? 'var(--accent-warn)' : 'var(--signal)' }} />
          </span>
          <b style={{ color: peak >= SATURATION_WARN ? 'var(--accent-warn)' : 'var(--ink)', fontWeight: 500 }}>
            {Math.round(peak * 100)}%</b>
        </span>
      )}
      <span style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={folder ?? undefined}>{folder}</span>
      <span>
        <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Integ</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.integration} ms</b>
      </span>
      <span>
        <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Avg</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.averaging}</b>
      </span>
      <span>
        <span style={{ fontSize: 'var(--text-xs)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mode</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.mode}</b>
      </span>
    </footer>
  );
}
