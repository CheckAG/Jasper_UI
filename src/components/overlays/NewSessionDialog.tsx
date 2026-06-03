import { useState, useEffect } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { ipc }             from '../../lib/ipc';
import { Button }          from '../design/Button';
import type { DeviceInfo } from '../../lib/types';

export function NewSessionDialog() {
  const [name, setName] = useState('');
  const [device, setDevice] = useState('');
  const [method, setMethod] = useState('NIR-Std');
  const [operator, setOperator] = useState('');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const { addSession, setActiveSession } = useSessionStore();
  const { setNewSessionOpen } = useUIStore();

  useEffect(() => {
    ipc.discoverDevices().then(d => {
      setDevices(d);
      if (d.length) setDevice(d[0].id);
    });
  }, []);

  function create() {
    if (!name.trim()) return;
    const session = addSession(name.trim(), device, method, operator.trim());
    setActiveSession(session.id);
    setNewSessionOpen(false);
    setName('');
    setOperator('');
  }

  return (
    <div onClick={() => setNewSessionOpen(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 440, background: 'var(--paper)', border: '1px solid var(--line)',
        borderRadius: 14, boxShadow: '0 30px 80px -20px rgba(15,17,21,0.45)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>New Session</h4>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            Creates a new acquisition session
          </span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { label: 'Session name', content: (
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Maize Leaf — Run 5"
                style={{ height: 36, padding: '0 10px', width: '100%',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--paper)', color: 'var(--ink)',
                  fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none',
                  boxSizing: 'border-box' }} />
            )},
            { label: 'Instrument', content: (
              <select value={device} onChange={e => setDevice(e.target.value)}
                style={{ height: 36, padding: '0 10px', width: '100%',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--paper)', color: 'var(--ink)',
                  fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer',
                  boxSizing: 'border-box' }}>
                {devices.map(d => <option key={d.id} value={d.id}>{d.name} — {d.model}</option>)}
              </select>
            )},
            { label: 'Method', content: (
              <select value={method} onChange={e => setMethod(e.target.value)}
                style={{ height: 36, padding: '0 10px', width: '100%',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--paper)', color: 'var(--ink)',
                  fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer',
                  boxSizing: 'border-box' }}>
                {['NIR-Std', 'NIR-Hi-Res', 'Soil-Cal', 'Blank'].map(m =>
                  <option key={m} value={m}>{m}</option>
                )}
              </select>
            )},
            { label: 'Operator (optional)', content: (
              <input value={operator} onChange={e => setOperator(e.target.value)}
                placeholder="who is running this session"
                style={{ height: 36, padding: '0 10px', width: '100%',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--paper)', color: 'var(--ink)',
                  fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none',
                  boxSizing: 'border-box' }} />
            )},
          ].map(field => (
            <div key={field.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'var(--muted)' }}>{field.label}</label>
              {field.content}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          <Button variant="ghost" onClick={() => setNewSessionOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>Create session</Button>
        </div>
      </div>
    </div>
  );
}
