import { useCallback, useEffect, useState } from 'react';
import { useAcqStore }     from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { ipc }             from '../../lib/ipc';

/** What the backend is actually holding. Asked for, not assumed — the frames
 *  live in Rust and a local guess would claim a calibration that is not there. */
type CalHeld = { dark: boolean; reference: boolean };

export function ModeStrip() {
  const { params, paused, setParam, setPaused } = useAcqStore();
  const liveSpectrum = useAcqStore(s => s.liveSpectrum);
  const { captures, selectedIds, clearSelected, toggleSelected } = useSessionStore();
  const pushToast = useUIStore(s => s.pushToast);

  const [held, setHeld] = useState<CalHeld>({ dark: false, reference: false });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    () => ipc.getCalibrationState().then(state => {
      setHeld(state);
      // With the Abs/Refl/Trans chips gone, what the pipeline computes follows
      // from what has been measured rather than from a button:
      //   neither        → raw counts
      //   dark only      → dark-subtracted counts
      //   dark + reference → absorbance
      // `intensity` is the mode that means "subtract the dark if there is one",
      // and `absorbance` needs both frames, so this is the honest progression.
      const mode = state.dark && state.reference ? 'absorbance' : 'intensity';
      if (useAcqStore.getState().params.mode !== mode) {
        useAcqStore.getState().setParam('mode', mode);
      }
    }).catch(() => {}),
    [],
  );
  useEffect(() => { refresh(); }, [refresh]);

  /** Take a calibration, or discard the one already held.
   *
   *  The button is the state: with nothing stored it reads "Dark" and captures
   *  one; with a frame stored it reads "Remove Dark" and flushes it. A dark
   *  taken at the wrong integration, or a reference against the wrong standard,
   *  is worse than none — so getting rid of one has to be one press. */
  async function toggleCal(which: 'dark' | 'reference') {
    setBusy(which);
    try {
      if (held[which]) {
        await ipc.clearCalibration(which);
      } else {
        // Tags the spectrum already on the plot — it does not go and measure
        // again. Freeze a good trace with Live, then designate it.
        const r = await ipc.tagLastFrame(which);
        if (r.warn) pushToast(`${which}: ${r.warn}`, 'info');
      }
      await refresh();
    } catch (e) {
      pushToast(String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const allSelected = captures.length > 0 && selectedIds.length === captures.length;

  function toggleAll() {
    if (allSelected || selectedIds.length > 0) {
      clearSelected();
    } else {
      captures.forEach(c => { if (!selectedIds.includes(c.id)) toggleSelected(c.id); });
    }
  }

  const chipBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', border: `1px solid ${active ? 'var(--signal)' : 'var(--line)'}`,
    borderRadius: 8, background: active ? 'var(--signal-soft)' : 'var(--paper)',
    color: active ? 'var(--signal)' : 'var(--ink-2)', cursor: 'pointer',
    fontFamily: 'var(--font-sans)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
  });

  /** Unset reads as a warning, not as a neutral option: without a dark and a
   *  reference the trace is raw counts, and that is worth seeing at a glance. */
  const calBtn = (isHeld: boolean): React.CSSProperties => ({
    ...chipBtn(false),
    border: `1px solid ${isHeld ? 'var(--signal)' : 'var(--accent-alarm, #c0392b)'}`,
    background: isHeld ? 'var(--signal-soft)' : 'transparent',
    color: isHeld ? 'var(--signal)' : 'var(--accent-alarm, #c0392b)',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {(['dark', 'reference'] as const).map(k => {
        const isHeld = held[k];
        const name = k === 'dark' ? 'Dark' : 'Reference';
        return (
          <button key={k} onClick={() => toggleCal(k)}
            disabled={busy !== null || (!isHeld && !liveSpectrum)}
            style={calBtn(isHeld)}
            title={isHeld
              ? `Discard the stored ${name.toLowerCase()}`
              : liveSpectrum
                ? `Use the spectrum on the plot as the ${name.toLowerCase()}`
                : 'No spectrum on the plot yet'}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isHeld ? 'var(--signal)' : 'var(--accent-alarm, #c0392b)',
            }} />
            {busy === k ? 'Working…' : isHeld ? `Remove ${name}` : name}
          </button>
        );
      })}

      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />

      {/* Stack toggle — color-coded vertical offset of selected spectra */}
      <button onClick={() => setParam('stack', !params.stack)} style={chipBtn(params.stack)}
        title="Stack selected spectra with vertical offset">
        ▤ Stack
      </button>

      {/* Select-all / clear overlay */}
      {captures.length > 0 && (
        <button onClick={toggleAll} style={chipBtn(false)}
          title="Overlay all / clear">
          {selectedIds.length > 0 ? `Clear (${selectedIds.length})` : 'Overlay all'}
        </button>
      )}

      <button onClick={() => setPaused(!paused)} style={{
        marginLeft: 'auto', padding: '6px 12px', border: '1px solid var(--line)',
        borderRadius: 8, background: paused ? 'var(--paper)' : 'var(--signal-soft)',
        color: paused ? 'var(--ink-2)' : 'var(--signal)',
        cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
      }} title={paused ? 'Resume the live stream' : 'Freeze the live stream'}>
        {paused ? '⏸ Paused' : '● Live'}
        <span className="mono" style={{ fontSize: 10, color: paused ? 'var(--muted)' : 'var(--signal)' }}>P</span>
      </button>
    </div>
  );
}
