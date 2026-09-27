import { useAcqStore }    from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { LED }             from '../design/LED';

export function TopBar() {
  const { params, deviceMeta, calHeld } = useAcqStore();
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>JASPER</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>by</span>
        <img src="/checkag.png" alt="CheckAg"
          style={{ height: 19, width: 'auto', display: 'block', flexShrink: 0 }} />
      </div>

      {/* Session pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px',
        border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)',
      }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{session?.name ?? 'No session'}</span>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {captures.length} captures
        </span>
        {/* Calibration actually held by the backend, not a local flag that
            defaulted to "ok" and showed three greens on a fresh install. */}
        {([['dark', calHeld.dark], ['reference', calHeld.reference]] as const).map(([k, on]) => (
          <LED key={k} status={on ? 'ok' : 'pending'} size={7} />
        ))}
      </div>

      {/* Instrument pill — the connected device, or an instruction to connect
          one. It used to show session.device with a hardcoded 42.1 °C beside a
          permanently green LED, so it claimed a connection whatever was true. */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10,
        background: 'var(--paper)', fontSize: 12 }}>
        <LED status={deviceMeta ? 'ok' : 'pending'} size={7} />
        {deviceMeta ? (
          <>
            <span className="mono">
              {deviceMeta.model}
              {deviceMeta.serial && ` · ${deviceMeta.serial.slice(-6)}`}
            </span>
            <span style={{ color: 'var(--muted)' }}>·</span>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              {params.integration} ms{params.averaging > 1 && ` × ${params.averaging}`}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--muted)' }}>Connect a device</span>
        )}
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
