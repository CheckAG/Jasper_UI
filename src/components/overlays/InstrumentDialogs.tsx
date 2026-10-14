import { useState, useEffect } from 'react';
import { useAcqStore }   from '../../store/acqStore';
import { useUIStore }    from '../../store/uiStore';
import { ipc }           from '../../lib/ipc';
import { LED }           from '../design/LED';
import { Button }        from '../design/Button';
import { Modal }         from './Modal';
import type { DeviceInfo, DiagEntry, CalStatus, Profile } from '../../lib/types';

/** X-axis (wavelength) calibration. Dark and reference are taken from the toolbar. */
function CalibrationPanel({ connected }: { connected: boolean }) {
  const pushToast = useUIStore(s => s.pushToast);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [rms, setRms] = useState<Record<string, number>>({});

  async function runCal(key: 'xcal') {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const result = await ipc.calibrateXcal();
      if (result.rms) setRms(r => ({ ...r, [key]: result.rms! }));
    } catch (e) {
      pushToast(String(e), 'error');
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }

  /** X-axis calibration has no backend yet (E5), so it is never "done". */
  const statusOf = (_key: 'xcal'): CalStatus => 'pending';

  const rows = [
    { key: 'xcal' as const, label: 'X-axis cal', sub: 'Known wavelength source for axis calibration' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        Fits the pixel → nm axis from a neon or argon lamp. Until it is fitted the x-axis is the
        pixel index. Dark and reference are taken from the toolbar.
      </span>

      {!connected && (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Connect an instrument to run a calibration.
        </span>
      )}
      {rows.map(row => (
        <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            background: statusOf(row.key) === 'ok' ? 'var(--accent-ok)' : 'var(--tint-2)',
            border: `2px solid ${statusOf(row.key) === 'ok' ? 'var(--accent-ok)' : 'var(--line-2)'}`,
            boxShadow: statusOf(row.key) === 'ok' ? '0 0 0 4px rgba(31,157,85,0.14)' : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{row.label}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {row.sub}
              {rms[row.key] && <span className="mono" style={{ marginLeft: 8 }}>RMS {rms[row.key].toFixed(3)} nm</span>}
            </div>
          </div>
          <Button size="sm"
            variant={statusOf(row.key) === 'ok' ? 'ghost' : 'primary'}
            disabled={!connected || loading[row.key]}
            title={connected ? undefined : 'Connect an instrument first'}
            onClick={() => runCal(row.key)}>
            {loading[row.key] ? 'Running…' : statusOf(row.key) === 'ok' ? 'Re-run' : 'Run'}
          </Button>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--muted)' }}>{label}</span>
      <span className={mono ? 'mono' : undefined}
        style={{ fontSize: 13, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

/** What the instrument reports about itself.
 *
 *  Replaces the old telemetry tiles: this hardware has no temperature sensor,
 *  no lamp, no drift estimate and no queue, so those four readouts were showing
 *  numbers the device never sent. Everything here is read during the handshake
 *  or counted from frame headers. */
export function InstrumentCard() {
  const meta = useAcqStore(s => s.deviceMeta);
  const setDialog = useUIStore(s => s.setDialog);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)',
      padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
          color: 'var(--muted)' }}>Instrument</span>
        <LED status={meta ? 'ok' : 'pending'} size={7} />
      </div>
      {!meta ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            No instrument connected. Connect one, or run tools/tcd1304-sim.py and enter the pty it prints.
          </span>
          <Button variant="primary" onClick={() => setDialog('instruments')}>Connect…</Button>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Model"    value={meta.model} />
            <Field label="Sensor"   value={meta.sensor || '—'} />
            <Field label="Serial"   value={meta.serial || '—'} />
            <Field label="Port"     value={meta.port} />
            <Field label="Firmware" value={meta.firmware} />
            <Field label="Protocol" value={`v${meta.protocolVersion}`} />
          </div>
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Pixels"      value={meta.pixels.toLocaleString()} />
            <Field label="Integration" value={`${meta.integMinMs}–${meta.integMaxMs} ms`} />
            <Field label="Full scale"  value={meta.maxIntensity.toLocaleString()} />
            <Field label="Last frame"  value={meta.lastCaptureMs ? `#${meta.lastSeq} · ${meta.lastCaptureMs} ms` : '—'} />
          </div>
          {meta.droppedFrames > 0 && (
            <span style={{ fontSize: 12, color: 'var(--warn, var(--muted))' }}>
              {meta.droppedFrames} frame{meta.droppedFrames === 1 ? '' : 's'} arrived one
              integration period late (missed a USB write slot). The data is valid.
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Instruments the host can see, and the controls to connect one.
 *
 *  Every entry answered a protocol handshake on a real port — nothing is listed
 *  that did not identify itself. When no hardware is attached the list is
 *  empty, and the port field below is how you reach anything the scan cannot
 *  see (a pty from tools/tcd1304-sim.py, or a port under an unusual name). */
function DeviceSelector({ devices, connectedId, busy, error, onConnect, onDisconnect, onRescan }: {
  devices: DeviceInfo[];
  connectedId: string | null;
  busy: boolean;
  error: string | null;
  onConnect: (id: string) => void;
  onDisconnect: () => void;
  onRescan: () => void;
}) {
  const [manual, setManual] = useState('');
  const reconnecting = useAcqStore(s => s.reconnecting);
  const connected = devices.find(d => d.id === connectedId) ?? null;
  const others = devices.filter(d => d.id !== connectedId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Every serial port is probed with *IDN?.</span>
        <Button onClick={onRescan} disabled={busy}>{busy ? 'Scanning…' : 'Rescan'}</Button>
      </div>

      {/* The connected board's cable was pulled; the backend keeps looking for it
          until it is back or the user gives up (Disconnect stops the search). */}
      {reconnecting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--line)', borderRadius: 10 }}>
          <LED status="fault" />
          <span style={{ fontSize: 13, flex: 1 }}>Instrument lost. Waiting for it to be plugged back in…</span>
          <Button onClick={onDisconnect} disabled={busy}>Stop waiting</Button>
        </div>
      )}

      {/* One instrument at a time: the backend holds a single driver, and
          connecting to another releases the current one first. */}
      {connected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--signal)', borderRadius: 10, background: 'var(--signal-soft)' }}>
          <LED status="ok" />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Connected — {connected.name}</span>
            <small className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{connected.id}</small>
          </div>
          <Button onClick={onDisconnect} disabled={busy}>Disconnect</Button>
        </div>
      )}

      {others.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {connected
            ? 'No other instrument found.'
            : 'No instrument found. Every serial port was probed and none answered as a supported spectrometer — check the cable, or enter a port below.'}
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--muted)' }}>
            {connected ? 'Switch to' : 'Available'}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {others.map(d => d.status === 'bootloader' ? (
              <div key={d.id} title="This board is waiting for firmware — install it from Device ▸ Firmware update"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  border: '1px dashed var(--accent-warn)', borderRadius: 10 }}>
                <LED status="pending" />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</span>
                <small className="mono" style={{ color: 'var(--accent-warn)', fontSize: 11 }}>needs firmware</small>
              </div>
            ) : (
              <button key={d.id} disabled={busy} onClick={() => onConnect(d.id)}
                title={connected ? `Release ${connected.id} and connect to ${d.id}` : `Connect to ${d.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)',
                  cursor: busy ? 'progress' : 'pointer', fontFamily: 'var(--font-sans)',
                }}>
                <LED status="idle" />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</span>
                <small className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{d.id}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={e => { e.preventDefault(); const p = manual.trim(); if (p) { onConnect(p); setManual(''); } }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={manual}
          onChange={e => setManual(e.target.value)}
          placeholder="/dev/ttyACM0 or /dev/pts/N"
          className="mono"
          style={{ flex: 1, minWidth: 0, padding: '7px 10px', fontSize: 12,
            border: '1px dashed var(--line-2)', borderRadius: 10,
            background: 'transparent', color: 'var(--ink-2)' }}
        />
        <Button type="submit" disabled={busy || !manual.trim()}>Connect</Button>
      </form>

      {error && (
        <span style={{ fontSize: 12, color: 'var(--danger, var(--muted))', lineHeight: 1.5 }}>{error}</span>
      )}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  restart: 'Restarting into the bootloader…', erase: 'Erasing…', write: 'Writing…',
  verify: 'Verifying…', boot: 'Starting the new firmware…',
};

/** Install a firmware image we ship as an .srec file.
 *
 *  Works on the connected board, or on one discovery found sitting in its
 *  bootloader — that is where an interrupted update leaves it, and running the
 *  update again is the recovery. The bootloader itself is never overwritten. */
function FirmwarePanel({ target, onDone }: { target: DeviceInfo | null; onDone: () => void }) {
  const pushToast = useUIStore(s => s.pushToast);
  const setPaused = useAcqStore(s => s.setPaused);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = progress !== null;

  async function install() {
    if (!target || !file) return;
    setError(null);
    setPaused(true);
    setProgress({ stage: 'restart', done: 0, total: 1 });
    const stop = ipc.onFirmwareProgress((stage, done, total) => setProgress({ stage, done, total }));
    try {
      const version = await ipc.updateFirmware(target.id, await file.text());
      pushToast(`Firmware ${version} installed.`, 'info');
      setFile(null);
    } catch (e) {
      setError(String(e));
    } finally {
      stop();
      setProgress(null);
      onDone();
    }
  }

  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{target ? target.name : 'No instrument'}</span>
        {target && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {target.status === 'bootloader' ? 'in bootloader' : `installed ${target.firmware}`}
          </span>
        )}
      </div>
      {!target ? (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Connect an instrument to update its firmware.</span>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="file" accept=".srec,.s19,.mot" disabled={running}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              style={{ flex: 1, minWidth: 0, fontSize: 12 }} />
            <Button variant="primary" disabled={!file || running} onClick={install}>
              {running ? 'Updating…' : 'Install'}
            </Button>
          </div>
          {running ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12 }}>{STAGE_LABEL[progress.stage] ?? progress.stage}</span>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--tint-2)', overflow: 'hidden' }}>
                <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--signal)' }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--accent-warn)' }}>Keep the instrument plugged in.</span>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              Use the .srec file supplied by CheckAG. If an update is interrupted the instrument
              waits in its bootloader; run the update again to finish it.
            </span>
          )}
        </>
      )}
      {error && <span style={{ fontSize: 12, color: 'var(--accent-alarm)', lineHeight: 1.5 }}>{error}</span>}
    </div>
  );
}

function DiagnosticsLog({ entries }: { entries: DiagEntry[] }) {
  const COLORS: Record<string, string> = {
    info: 'var(--accent-ok)', warn: 'var(--accent-warn)', error: 'var(--accent-alarm)',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Nothing logged yet. Connects, device errors and dropped frames appear here.
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.slice(-50).reverse().map(e => (
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

/** Instruments the host can see. Discovery is run on open and on Rescan only —
 *  it opens and handshakes every serial port on the machine, which is not
 *  something to do on a timer. */
function useDevices() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const refreshInstrument = useAcqStore(s => s.refreshInstrument);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => Promise.all([
    ipc.discoverDevices().then(setDevices).catch(() => setDevices([])),
    refreshInstrument(),
  ]);
  const run = (p: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    p().then(refresh).catch(e => setError(String(e))).finally(() => setBusy(false));
  };
  useEffect(() => { run(() => Promise.resolve()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return { devices, busy, error, refresh, run };
}

function InstrumentsDialog({ onClose }: { onClose: () => void }) {
  const { devices, busy, error, run } = useDevices();
  // The connected device is whichever one the backend reports as online, so the
  // UI cannot claim a connection the driver does not have.
  const connectedId = devices.find(d => d.status === 'online')?.id ?? null;
  return (
    <Modal title="Instruments" subtitle="One instrument at a time" onClose={onClose}>
      <DeviceSelector
        devices={devices} connectedId={connectedId} busy={busy} error={error}
        onConnect={id => run(() => ipc.connectDevice(id))}
        onDisconnect={() => run(() => ipc.disconnectDevice())}
        onRescan={() => run(() => Promise.resolve())}
      />
    </Modal>
  );
}

function FirmwareDialog({ onClose }: { onClose: () => void }) {
  const { devices, refresh } = useDevices();
  const target = devices.find(d => d.status === 'online') ?? devices.find(d => d.status === 'bootloader') ?? null;
  return (
    <Modal title="Firmware update" onClose={onClose}>
      <FirmwarePanel target={target} onDone={refresh} />
    </Modal>
  );
}

function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const [diag, setDiag] = useState<DiagEntry[]>([]);
  useEffect(() => {
    const load = () => ipc.getDiagnostics().then(setDiag).catch(() => {});
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <Modal title="Diagnostics" subtitle="Connects, device errors and late frames" width={640} onClose={onClose}>
      <DiagnosticsLog entries={diag} />
    </Modal>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Space', 'Capture (Live off)'], ['L', 'Live / freeze'], ['D', 'Take / remove dark'],
    ['R', 'Take / remove reference'], ['⌘K / Ctrl+K', 'Command palette'], ['Esc', 'Close'],
    ['Drag · right-drag', 'Zoom box · pan the plot'], ['Double-click', 'Fit the plot'],
  ];
  return (
    <Modal title="Keyboard shortcuts" width={420} onClose={onClose}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span>{v}</span><span className="mono" style={{ color: 'var(--muted)' }}>{k}</span>
        </div>
      ))}
    </Modal>
  );
}

/** N captures, optionally spaced out in time. The burst runs in the backend;
 *  closing the dialog does not stop it, Stop does (keeping the shots taken). */
function BurstDialog({ onClose }: { onClose: () => void }) {
  const { runBurst, sampleTag, captureProgress, paused, burstSettings, setBurstSettings } = useAcqStore();
  const { count, seconds, label } = burstSettings;
  const [tag, setTag] = useState(sampleTag);
  // From the store, so reopening the dialog mid-burst still shows progress and Stop.
  const running = captureProgress !== null;
  const valid = Number.isInteger(count) && count >= 1 && count <= 1000 && seconds >= 0 && seconds <= 3600;
  const input = { height: 'var(--row-h)', padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8,
    background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' };
  const field = (name: string, el: React.ReactNode, hint?: string) => (
    <label style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 10, fontSize: 13 }} title={hint}>
      <span>{name}</span>{el}
    </label>
  );
  const start = () => { runBurst(count, Math.round(seconds * 1000), label, tag); };
  return (
    <Modal title="Burst capture" subtitle="Each shot is a full capture, saved in the workspace" width={440} onClose={onClose}>
      {field('Shots', <input type="number" min={1} max={1000} step={1} value={count} disabled={running}
        onChange={e => setBurstSettings({ count: Number(e.target.value) })} style={input} />, '1 to 1000')}
      {field('Interval (s)', <input type="number" min={0} max={3600} step={0.1} value={seconds} disabled={running}
        onChange={e => setBurstSettings({ seconds: Number(e.target.value) })} style={input} />, 'From the start of one shot to the next. 0 = back to back.')}
      {field('Name', <input type="text" placeholder="spectra_### (automatic)" value={label} disabled={running}
        onChange={e => setBurstSettings({ label: e.target.value })} style={input} />, 'Shots are named name_001, name_002, …')}
      {field('Sample tag', <input type="text" value={tag} disabled={running}
        onChange={e => setTag(e.target.value)} style={input} />)}
      {running && captureProgress && (
        <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--line)' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 3, background: 'var(--signal)',
            transformOrigin: 'left', transform: `scaleX(${captureProgress.done / captureProgress.total})`,
            transition: 'transform 200ms ease-out' }} />
          {captureProgress.done > 0 && <span key={captureProgress.done} aria-hidden className="shot-flash" />}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
        {running && <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginRight: 'auto' }}>
          Shot {captureProgress?.done ?? 0} of {captureProgress?.total ?? count}</span>}
        {!paused && !running && <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 'auto' }}>Turn Live off first.</span>}
        {running
          ? <Button onClick={() => { ipc.stopLive().catch(() => {}); }}>Stop</Button>
          : <Button variant="primary" disabled={!valid || !paused} onClick={start}>Start</Button>}
      </div>
    </Modal>
  );
}

/** Save the current integration, averaging and burst settings under a name;
 *  load or delete saved ones. */
function ProfilesDialog({ onClose }: { onClose: () => void }) {
  const { params, burstSettings, writeSetting, setBurstSettings } = useAcqStore();
  const pushToast = useUIStore(s => s.pushToast);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  useEffect(() => { ipc.loadProfiles().then(setProfiles).catch(e => pushToast(String(e), 'error')); }, [pushToast]);

  const store = (next: Profile[]) => ipc.saveProfiles(next).then(() => setProfiles(next))
    .catch(e => pushToast(String(e), 'error'));
  const save = () => {
    const n = name.trim();
    const p: Profile = { name: n, integration: params.integration, averaging: params.averaging, burst: { ...burstSettings } };
    // Same name overwrites: saving "Leaf" again updates it.
    store([...profiles.filter(x => x.name !== n), p].sort((a, b) => a.name.localeCompare(b.name)));
    setName('');
  };
  const load = async (p: Profile) => {
    await writeSetting('integration', p.integration);
    await writeSetting('averaging', p.averaging);
    setBurstSettings(p.burst);
    pushToast(`Loaded profile "${p.name}".`, 'success');
  };
  const summary = (p: Profile) => `${p.integration} ms · avg ${p.averaging} · burst ${p.burst.count}` +
    (p.burst.seconds ? ` every ${p.burst.seconds} s` : '') + (p.burst.label ? ` as ${p.burst.label}_###` : '');

  return (
    <Modal title="Settings profiles" subtitle="Integration, averaging and burst settings" width={480} onClose={onClose}>
      {profiles.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No profiles yet.</span>}
      {profiles.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{summary(p)}</div>
          </div>
          <Button size="sm" onClick={() => load(p)}>Load</Button>
          <Button size="sm" variant="danger" onClick={() => store(profiles.filter(x => x !== p))}>Delete</Button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <input type="text" placeholder="Profile name" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save(); }}
          style={{ flex: 1, height: 'var(--row-h)', padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8,
            background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }} />
        <Button variant="primary" disabled={!name.trim()} onClick={save}
          title={profiles.some(p => p.name === name.trim()) ? 'Replaces the profile with this name' : undefined}>
          Save current
        </Button>
      </div>
    </Modal>
  );
}

/** Whichever menu-bar dialog is open. */
export function DeviceDialogs() {
  const { dialog, setDialog } = useUIStore();
  const connected = useAcqStore(s => s.deviceMeta !== null);
  const close = () => setDialog(null);
  switch (dialog) {
    case 'instruments': return <InstrumentsDialog onClose={close} />;
    case 'firmware':    return <FirmwareDialog onClose={close} />;
    case 'diagnostics': return <DiagnosticsDialog onClose={close} />;
    case 'shortcuts':   return <ShortcutsDialog onClose={close} />;
    case 'burst':       return <BurstDialog onClose={close} />;
    case 'profiles':    return <ProfilesDialog onClose={close} />;
    case 'xcal':        return <Modal title="X-axis calibration" onClose={close}><CalibrationPanel connected={connected} /></Modal>;
    default:            return null;
  }
}
