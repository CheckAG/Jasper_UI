import { useEffect, useState } from 'react';
import { useAcqStore } from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { ipc } from '../../lib/ipc';

export function StatusBar() {
  const { params, cursor } = useAcqStore();
  // Where this workspace's .jdx files go.
  const name = useSessionStore(s => s.activeSession()?.name);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => { if (name) ipc.workspaceDir(name).then(setFolder); }, [name]);

  return (
    <footer style={{
      display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px',
      borderTop: '1px solid var(--line)', background: 'var(--paper)',
      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)',
      height: 32, flexShrink: 0,
    }}>
      {cursor ? (
        <>
          <span>
            <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>x</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{Math.round(cursor.x)} px</b>
          </span>
          <span>
            <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>y</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cursor.y.toFixed(3)}</b>
          </span>
          <span>
            <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>SNR</span>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cursor.snr}</b>
          </span>
        </>
      ) : (
        <span>Hover spectrum for readout</span>
      )}
      <span style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={folder ?? undefined}>{folder}</span>
      <span>
        <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Integ</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.integration} ms</b>
      </span>
      <span>
        <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Avg</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.averaging}</b>
      </span>
      <span>
        <span style={{ fontSize: 10, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mode</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{params.mode}</b>
      </span>
    </footer>
  );
}
