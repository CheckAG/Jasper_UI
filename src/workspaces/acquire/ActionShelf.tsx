import { useEffect, useRef, useState } from 'react';
import { useAcqStore }   from '../../store/acqStore';
import { ipc }           from '../../lib/ipc';
import { LAMP_CONTROLS_ENABLED } from '../../lib/features';
import { useSessionStore}from '../../store/sessionStore';
import { Toggle }        from '../../components/design/Toggle';
import { sampleCapture } from '../../lib/mockDriver';

export function ActionShelf() {
  const { params, setParam } = useAcqStore();
  const { captures, addCapture } = useSessionStore();
  const tagRef = useRef('');

  // Integration bounds come from the device, not from a guess. The old 5-500 ms
  // range let the slider ask for values this hardware rejects (its floor is the
  // 7.4 ms it takes to clock 3694 pixels out), so the control moved and the
  // device quietly did something else.
  const [range, setRange] = useState({ min: 8, max: 10_000 });
  useEffect(() => {
    ipc.getDeviceMetadata()
      .then(m => { if (m) setRange({ min: m.integMinMs, max: m.integMaxMs }); })
      .catch(() => {});
  }, []);

  function doCapture() {
    // Snapshot the frame currently on the canvas (real stream or param-matched mock)
    const { liveSpectrum } = useAcqStore.getState();
    const s = liveSpectrum ?? sampleCapture(params, performance.now() / 1000);
    addCapture(params, s.xs, s.ys, tagRef.current);
  }

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
          <input type="range" min={range.min} max={range.max} step={1}
            value={Math.min(Math.max(params.integration, range.min), range.max)}
            onChange={e => setParam('integration', Number(e.target.value))}
            style={{ flex: 1, minWidth: 0, accentColor: 'var(--signal)' }} />
          <span className="mono" style={{ fontSize: 14, minWidth: 52, textAlign: 'right', flexShrink: 0 }}>
            {params.integration}<small style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 3 }}>ms</small>
          </span>
        </div>
      </div>

      {/* Averaging */}
      <div style={{ ...fieldStyle, flex: '0 1 130px' }}>
        <label className="mono" style={labelStyle}>Averaging</label>
        <div style={{ ...rowStyle, gap: 6 }}>
          <button onClick={() => setParam('averaging', Math.max(1, params.averaging - 1))}
            style={{ width: 28, height: 28, flexShrink: 0, border: '1px solid var(--line)', borderRadius: 8,
              background: 'var(--paper)', cursor: 'pointer', fontSize: 16 }}>−</button>
          <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 14 }}>{params.averaging}</span>
          <button onClick={() => setParam('averaging', Math.min(64, params.averaging + 1))}
            style={{ width: 28, height: 28, flexShrink: 0, border: '1px solid var(--line)', borderRadius: 8,
              background: 'var(--paper)', cursor: 'pointer', fontSize: 16 }}>+</button>
        </div>
      </div>

      {/* Light source — no driver reads lightOn/lightPower and this hardware
          has no lamp command, so the controls are hidden rather than lying. */}
      {LAMP_CONTROLS_ENABLED && (
        <div style={{ ...fieldStyle, flex: '1 1 200px' }}>
          <label className="mono" style={labelStyle}>Light Source</label>
          <div style={rowStyle}>
            <Toggle on={params.lightOn} onChange={v => setParam('lightOn', v)} label={params.lightOn ? 'ON' : 'OFF'} />
            <input type="range" min={0} max={100} value={params.lightPower}
              disabled={!params.lightOn}
              onChange={e => setParam('lightPower', Number(e.target.value))}
              style={{ flex: 1, minWidth: 0, accentColor: 'var(--signal)', opacity: params.lightOn ? 1 : 0.4 }} />
            <span className="mono" style={{ fontSize: 13, minWidth: 40, textAlign: 'right', flexShrink: 0 }}>
              {params.lightPower}<small style={{ color: 'var(--muted)', marginLeft: 2, fontSize: 11 }}>%</small>
            </span>
          </div>
        </div>
      )}

      {/* Sample tag */}
      <div style={fieldStyle}>
        <label className="mono" style={labelStyle}>Sample Tag</label>
        <input type="text" placeholder="e.g. leaf · stress"
          onChange={e => { tagRef.current = e.target.value; }}
          style={{ height: 'var(--row-h)', padding: '0 10px', border: '1px solid var(--line)',
            borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)',
            fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', minWidth: 0 }} />
      </div>

      {/* Capture CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 180px', minWidth: 0 }}>
        <button onClick={doCapture} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '10px 14px', background: 'var(--ink)', color: 'var(--paper)',
          border: 0, borderRadius: 10, cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600,
          boxShadow: '0 6px 16px -8px rgba(15,17,21,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff6a6a',
            boxShadow: '0 0 0 3px rgba(255,106,106,0.22)', flexShrink: 0 }} />
          Capture
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px',
            borderRadius: 4, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}>
            Space
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
