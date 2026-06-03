import { useAcqStore }    from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { LED }             from '../design/LED';

export function TopBar() {
  const { params, refState } = useAcqStore();
  const { captures, activeSession } = useSessionStore();
  const { setCmdOpen } = useUIStore();
  const session = activeSession();

  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 18, padding: '8px 16px', height: 52,
      borderBottom: '1px solid var(--line)',
      background: 'linear-gradient(var(--paper), var(--bg))',
      flexShrink: 0,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'conic-gradient(from 200deg, #1f5dff, #06b6c4, #6b4ee0, #1f5dff)',
          boxShadow: 'inset 0 0 0 2px var(--paper)', flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>JASPER</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          by CheckAg
        </span>
      </div>

      {/* Session pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px',
        border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)',
      }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{session?.name ?? 'No session'}</span>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {session?.device} · {captures.length} captures
        </span>
        {(['dark', 'reference', 'xcal'] as const).map(k => (
          <LED key={k} status={refState[k]} size={7} />
        ))}
      </div>

      {/* Instrument pill */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10,
        background: 'var(--paper)', fontSize: 12 }}>
        <LED status="ok" size={7} />
        <span className="mono">{session?.device ?? '—'}</span>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <span className="mono" style={{ color: 'var(--muted)' }}>42.1 °C · {params.integration} ms</span>
      </div>

      {/* Command bar trigger */}
      <button onClick={() => setCmdOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px 5px 12px',
        border: '1px solid var(--line)', borderRadius: 10,
        background: 'var(--paper)', cursor: 'pointer', color: 'var(--ink-2)',
        fontFamily: 'var(--font-sans)', fontSize: 12,
      }}>
        <span className="mono" style={{
          fontSize: 11, padding: '2px 6px', borderRadius: 6,
          background: 'var(--tint-2)', color: 'var(--ink)',
        }}>⌘K</span>
        Search or go to…
      </button>
    </header>
  );
}
