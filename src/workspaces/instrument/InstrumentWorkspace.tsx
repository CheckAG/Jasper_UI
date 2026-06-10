import { useState, useEffect } from 'react';
import { useAcqStore }   from '../../store/acqStore';
import { ipc }           from '../../lib/ipc';
import { WorkspaceShell }from '../../components/layout/WorkspaceShell';
import { LED }           from '../../components/design/LED';
import { Button }        from '../../components/design/Button';
import { MonoReadout }   from '../../components/design/MonoReadout';
import type { DeviceInfo, Telemetry, DiagEntry, CalStatus } from '../../lib/types';

function CalibrationPanel() {
  const { refState, params, setRefState } = useAcqStore();
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [rms, setRms] = useState<Record<string, number>>({});

  async function runCal(key: 'dark' | 'reference' | 'xcal') {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const result = key === 'xcal'
        ? await ipc.calibrateXcal()
        : key === 'dark'
          ? await ipc.calibrateDark(params)
          : await ipc.calibrateReference(params);
      setRefState({ [key]: result.status as CalStatus });
      if ('rms' in result && result.rms) setRms(r => ({ ...r, [key]: result.rms! }));
      if ('warn' in result && result.warn) console.warn(`calibration ${key}: ${result.warn}`);
    } catch (e) {
      console.error(`calibration ${key} failed:`, e);
      setRefState({ [key]: 'fault' });
    } finally {
      // Dark/reference capture pauses the acquisition stream — resume it
      if (key !== 'xcal') ipc.startAcquisition(params).catch(() => {});
      setLoading(l => ({ ...l, [key]: false }));
    }
  }

  const allOk = refState.dark === 'ok' && refState.reference === 'ok' && refState.xcal === 'ok';

  const rows = [
    { key: 'dark'      as const, label: 'Dark',        sub: 'Block light path, capture dark spectrum' },
    { key: 'reference' as const, label: 'Reference',   sub: 'White standard in path, capture reference' },
    { key: 'xcal'      as const, label: 'X-axis cal',  sub: 'Known wavelength source for axis calibration' },
  ];

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Calibration</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 12px', borderRadius: 999,
          border: `1px solid ${allOk ? 'rgba(31,157,85,0.4)' : 'var(--line)'}`,
          background: allOk ? 'rgba(31,157,85,0.08)' : 'var(--paper)',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: allOk ? 'var(--accent-ok)' : 'var(--accent-warn)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <LED status={allOk ? 'ok' : 'pending'} size={7} />
          {allOk ? 'Ready' : 'Not ready'}
        </span>
      </div>

      {rows.map(row => (
        <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            background: refState[row.key] === 'ok' ? 'var(--accent-ok)' : 'var(--tint-2)',
            border: `2px solid ${refState[row.key] === 'ok' ? 'var(--accent-ok)' : 'var(--line-2)'}`,
            boxShadow: refState[row.key] === 'ok' ? '0 0 0 4px rgba(31,157,85,0.14)' : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{row.label}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {row.sub}
              {rms[row.key] && <span className="mono" style={{ marginLeft: 8 }}>RMS {rms[row.key].toFixed(3)} nm</span>}
            </div>
          </div>
          <Button size="sm"
            variant={refState[row.key] === 'ok' ? 'ghost' : 'primary'}
            disabled={loading[row.key]}
            onClick={() => runCal(row.key)}>
            {loading[row.key] ? 'Running…' : refState[row.key] === 'ok' ? 'Re-run' : 'Run'}
          </Button>
        </div>
      ))}
    </div>
  );
}

function TelemetryPanel({ telemetry }: { telemetry: Telemetry | null }) {
  if (!telemetry) return null;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Telemetry</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <MonoReadout label="Detector temp" value={telemetry.tempC.toFixed(1)} unit="°C"
          delta={telemetry.driftSigma > 0.5 ? `+${telemetry.driftSigma.toFixed(2)}σ drift` : undefined} deltaUp />
        <MonoReadout label="Lamp hours" value={telemetry.lampHours} unit="hr" />
        <MonoReadout label="Headroom" value={telemetry.headroom} unit="%" />
        <MonoReadout label="Queue" value={telemetry.queueDepth} unit="frames" />
      </div>
    </div>
  );
}

function DeviceSelector({ devices, activeId, onConnect }: {
  devices: DeviceInfo[];
  activeId: string | null;
  onConnect: (id: string) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Instruments</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {devices.map(d => (
          <button key={d.id} onClick={() => onConnect(d.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            border: `1px solid ${activeId === d.id ? 'var(--signal)' : 'var(--line)'}`,
            borderRadius: 10,
            background: activeId === d.id ? 'var(--signal-soft)' : 'var(--paper)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}>
            <LED status={d.status === 'connected' ? 'ok' : d.status === 'fault' ? 'fault' : 'idle'} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</span>
            <small className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{d.tempC.toFixed(1)}°C</small>
          </button>
        ))}
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          border: '1px dashed var(--line-2)', borderRadius: 10, background: 'transparent',
          cursor: 'pointer', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
          + Add instrument
        </button>
      </div>
    </div>
  );
}

function DiagnosticsLog({ entries }: { entries: DiagEntry[] }) {
  const COLORS: Record<string, string> = {
    info: 'var(--accent-ok)', warn: 'var(--accent-warn)', error: 'var(--accent-alarm)',
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Diagnostics</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.slice(-15).reverse().map(e => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '80px 40px 1fr',
            gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)',
            fontSize: 12, color: 'var(--ink-2)' }}>
            <span className="mono" style={{ color: 'var(--muted)', fontSize: 10 }}>
              {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ color: COLORS[e.severity] ?? 'var(--muted)', fontWeight: 500 }}>
              {e.severity.toUpperCase()}
            </span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstrumentWorkspace() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [diag, setDiag] = useState<DiagEntry[]>([]);

  useEffect(() => {
    ipc.discoverDevices().then(setDevices);
    ipc.getDiagnostics().then(setDiag);
    const unsub = ipc.onTelemetry(t => setTelemetry(t));
    return unsub;
  }, []);

  return (
    <WorkspaceShell
      canvas={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>
              Instrument
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Setup & Calibration
            </h2>
          </div>
          <DeviceSelector devices={devices} activeId={activeDevice} onConnect={id => setActiveDevice(id)} />
          <CalibrationPanel />
          <TelemetryPanel telemetry={telemetry} />
          <DiagnosticsLog entries={diag} />
        </div>
      }
      context={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h5 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Device info</h5>
          {activeDevice ? (
            (() => {
              const d = devices.find(x => x.id === activeDevice);
              if (!d) return null;
              return (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '80px 1fr',
                  gap: '4px 10px', fontSize: 12 }}>
                  {[['Model', d.model], ['ID', d.id], ['Status', d.status], ['Temp', `${d.tempC.toFixed(1)} °C`]].map(([k, v]) => (
                    <>
                      <dt key={k + '-k'} className="mono" style={{ fontSize: 10, color: 'var(--muted)',
                        textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: 2 }}>{k}</dt>
                      <dd key={k + '-v'} style={{ margin: 0, color: 'var(--ink-2)' }}>{v}</dd>
                    </>
                  ))}
                </dl>
              );
            })()
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Select a device to see details</span>
          )}
        </div>
      }
    />
  );
}
