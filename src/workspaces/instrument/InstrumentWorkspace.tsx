import { useState, useEffect } from 'react';
import { useAcqStore }   from '../../store/acqStore';
import { useUIStore }    from '../../store/uiStore';
import { ipc }           from '../../lib/ipc';
import { WorkspaceShell }from '../../components/layout/WorkspaceShell';
import { LED }           from '../../components/design/LED';
import { Button }        from '../../components/design/Button';
import type { DeviceInfo, DeviceMetadata, DiagEntry, CalStatus } from '../../lib/types';

/** Dark and reference are taken in Acquire, from the spectrum on the plot.
 *  Only the x-axis calibration lives here. */
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Calibration</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
        Dark and reference are taken in the Acquire workspace.
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
function DeviceMetadataPanel({ meta }: { meta: DeviceMetadata | null }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Device</span>
      {!meta ? (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          No instrument connected.
        </span>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Model"    value={meta.model} />
            <Field label="Sensor"   value={meta.sensor || '—'} />
            <Field label="Serial"   value={meta.serial || '—'} />
            <Field label="Port"     value={meta.port} />
            <Field label="Firmware" value={meta.firmware} />
            <Field label="Protocol" value={`v${meta.protocolVersion}`} />
          </div>
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
  const connected = devices.find(d => d.id === connectedId) ?? null;
  const others = devices.filter(d => d.id !== connectedId);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Instruments</span>
        <Button onClick={onRescan} disabled={busy}>{busy ? 'Scanning…' : 'Rescan'}</Button>
      </div>

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
            : 'No instrument found. Every serial port was probed and none answered as a TCD1304 — check the cable, or enter a port below.'}
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--muted)' }}>
            {connected ? 'Switch to' : 'Available'}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {others.map(d => d.status === 'bootloader' ? (
              <div key={d.id} title="This board is waiting for firmware — install it under Firmware below"
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Firmware</span>
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', padding: 18,
      display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Diagnostics</span>
      {entries.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Nothing logged yet. Connects, device errors and dropped frames appear here.
        </span>
      )}
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
  const [devices, setDevices]   = useState<DeviceInfo[]>([]);
  // Device metadata comes from the shared store, polled once in App.tsx.
  const meta = useAcqStore(s => s.deviceMeta);
  const refreshInstrument = useAcqStore(s => s.refreshInstrument);
  const [diag, setDiag]         = useState<DiagEntry[]>([]);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // The connected device is whichever one the backend reports as online. Kept
  // from the backend rather than in local state, so the UI cannot claim a
  // connection the driver does not have.
  const connectedId = devices.find(d => d.status === 'online')?.id ?? null;

  const refresh = () => Promise.all([
    ipc.discoverDevices().then(setDevices).catch(() => setDevices([])),
    refreshInstrument(),
    ipc.getDiagnostics().then(setDiag).catch(() => setDiag([])),
  ]);

  const rescan = () => { setBusy(true); setError(null); refresh().finally(() => setBusy(false)); };

  const connect = (id: string) => {
    setBusy(true); setError(null);
    ipc.connectDevice(id)
      .then(refresh)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true); setError(null);
    ipc.disconnectDevice()
      .then(refresh)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    refresh();
    // Poll only the cheap calls: last frame, dropped count and the log change
    // with every capture. Discovery is not polled — it opens and handshakes
    // every serial port on the machine, which is not something to do on a timer.
    const id = setInterval(() => {
      // Device metadata is polled centrally; only the log needs a tick here.
      ipc.getDiagnostics().then(setDiag).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <DeviceSelector
            devices={devices} connectedId={connectedId} busy={busy} error={error}
            onConnect={connect} onDisconnect={disconnect} onRescan={rescan}
          />
          <CalibrationPanel connected={connectedId !== null} />
          <DeviceMetadataPanel meta={meta} />
          <FirmwarePanel
            target={devices.find(d => d.status === 'online') ?? devices.find(d => d.status === 'bootloader') ?? null}
            onDone={refresh}
          />
          <DiagnosticsLog entries={diag} />
        </div>
      }
      context={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h5 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Session</h5>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            {meta
              ? `Connected to ${meta.model} on ${meta.port}. Spectra are ${meta.pixels} pixels; the x-axis is pixel index until a wavelength calibration is fitted.`
              : 'No instrument connected. Connect one above, or run tools/tcd1304-sim.py and enter the pty it prints.'}
          </span>
        </div>
      }
    />
  );
}
