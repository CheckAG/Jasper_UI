import { useAcqStore }   from '../../store/acqStore';
import { useSessionStore}from '../../store/sessionStore';

export function ActionShelf() {
  const params = useAcqStore(s => s.params);
  const captures = useSessionStore(s => s.captures);
  const sampleTag = useAcqStore(s => s.sampleTag);
  const setSampleTag = useAcqStore(s => s.setSampleTag);

  const deviceMeta = useAcqStore(s => s.deviceMeta);
  const writeSetting = useAcqStore(s => s.writeSetting);
  // Integration bounds come from the device, not from a guess: its floor is the
  // 7.4 ms it takes to clock 3694 pixels out. The backend enforces them too.
  const range = deviceMeta ? { min: deviceMeta.integMinMs, max: deviceMeta.integMaxMs } : { min: 8, max: 10_000 };

  const paused = useAcqStore(s => s.paused);

  const progress = useAcqStore(s => s.captureProgress);
  const runCapture = useAcqStore(s => s.runCapture);

  const busyCapture = progress !== null;
  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;

  const fieldStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 6,
    flex: '1 1 175px', minWidth: 0,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, height: 'var(--row-h)', minWidth: 0,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)',
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end',
      gap: 16, padding: '12px 14px', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', background: 'var(--paper)', flexShrink: 0,
    }}>
      {/* Integration */}
      <div style={fieldStyle}>
        <label className="mono" style={labelStyle}>Integration Time</label>
        <div style={rowStyle}>
          {/* Commits on blur/Enter, not per keystroke: every change restarts the
              stream, so typing 1000 would otherwise send 1, 10, 100 first. Keyed
              on the applied value so a device-side clamp shows up here. */}
          <input key={params.integration} type="number" min={range.min} max={range.max} step={1}
            defaultValue={params.integration}
            onBlur={e => {
              const v = Math.round(Number(e.target.value));
              const clamped = Number.isFinite(v) ? Math.min(Math.max(v, range.min), range.max) : params.integration;
              if (clamped !== params.integration) writeSetting('integration', clamped);
              else e.target.value = String(params.integration);
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="mono"
            style={{ flex: 1, minWidth: 0, height: 'var(--row-h)', padding: '0 10px',
              border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)',
              color: 'var(--ink)', fontSize: 14, outline: 'none' }} />
          <small className="mono" style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>ms</small>
        </div>
      </div>

      {/* Averaging */}
      <div style={{ ...fieldStyle, flex: '0 1 130px' }}>
        <label className="mono" style={labelStyle}>Averaging</label>
        <div style={{ ...rowStyle, gap: 6 }}>
          <button onClick={() => writeSetting('averaging', Math.max(1, params.averaging - 1))}
            style={{ width: 28, height: 28, flexShrink: 0, border: '1px solid var(--line)', borderRadius: 8,
              background: 'var(--paper)', cursor: 'pointer', fontSize: 16 }}>−</button>
          <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 14 }}>{params.averaging}</span>
          <button onClick={() => writeSetting('averaging', Math.min(64, params.averaging + 1))}
            style={{ width: 28, height: 28, flexShrink: 0, border: '1px solid var(--line)', borderRadius: 8,
              background: 'var(--paper)', cursor: 'pointer', fontSize: 16 }}>+</button>
        </div>
      </div>

      {/* Sample tag */}
      <div style={fieldStyle}>
        <label className="mono" style={labelStyle}>Sample Tag</label>
        <input type="text" placeholder="e.g. leaf · stress"
          value={sampleTag} onChange={e => setSampleTag(e.target.value)}
          style={{ height: 'var(--row-h)', padding: '0 10px', border: '1px solid var(--line)',
            borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)',
            fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', minWidth: 0 }} />
      </div>

      {/* Capture CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 180px', minWidth: 0 }}>
        <button onClick={() => runCapture()}
          disabled={busyCapture || !paused || !deviceMeta}
          title={busyCapture
            ? `Capturing scan ${progress?.done ?? 0} of ${progress?.total ?? 0}`
            : !deviceMeta ? 'Connect an instrument first'
            : !paused ? 'Turn Live off to capture'
            : `Take ${Math.max(1, params.averaging)} scan${params.averaging > 1 ? 's' : ''} and record the average`}
          style={{
          position: 'relative', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '10px 14px', background: 'var(--ink)', color: 'var(--paper)',
          border: 0, borderRadius: 10, cursor: busyCapture ? 'progress' : 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600,
          boxShadow: '0 6px 16px -8px rgba(15,17,21,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}>
          {/* Progress fills the button itself: the thing you pressed is the
              thing that reports back, and it reads as "wait" without a separate
              spinner competing for the same corner of the screen. */}
          {busyCapture && (
            <span aria-hidden style={{
              position: 'absolute', inset: 0, transformOrigin: 'left',
              transform: `scaleX(${pct})`, background: 'rgba(var(--paper-rgb),0.18)',
              transition: 'transform 120ms linear', pointerEvents: 'none',
            }} />
          )}
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center',
            gap: 10, width: '100%' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%',
              background: busyCapture ? 'var(--paper)' : '#ff6a6a',
              boxShadow: busyCapture ? 'none' : '0 0 0 3px rgba(255,106,106,0.22)',
              flexShrink: 0 }} />
            {busyCapture ? `Capturing ${progress?.done ?? 0}/${progress?.total ?? 0}` : 'Capture'}
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px',
              borderRadius: 4, background: 'rgba(var(--paper-rgb),0.12)', color: 'rgba(var(--paper-rgb),0.8)' }}>
              Space
            </span>
          </span>
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 4px' }}>
          <span>{captures.length} captured</span>
          <span>{params.acqMode}</span>
        </div>
      </div>
    </div>
  );
}
