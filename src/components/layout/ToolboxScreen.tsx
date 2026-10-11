import { useAcqStore }        from '../../store/acqStore';
import { useSessionStore }    from '../../store/sessionStore';
import { useUIStore }         from '../../store/uiStore';
import { LiveSpectrum }       from '../../spectrum/LiveSpectrum';
import { ModeStrip }          from '../../workspaces/acquire/ModeStrip';
import { ActionShelf }        from '../../workspaces/acquire/ActionShelf';
import { CaptureContextPanel }from '../../workspaces/acquire/CaptureContextPanel';
import { InstrumentCard }     from '../overlays/InstrumentDialogs';
import { LED }                from '../design/LED';
import { MenuBar }            from './MenuBar';
import { StatusBar }          from './StatusBar';
import './toolbox.css';

/** Connection chip at the start of the toolbar: what is connected, or a way to connect. */
function ConnectionChip() {
  const meta = useAcqStore(s => s.deviceMeta);
  const setDialog = useUIStore(s => s.setDialog);
  return (
    <button onClick={() => setDialog('instruments')} title="Instruments" style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0,
      border: `1px solid ${meta ? 'var(--line)' : 'var(--accent-alarm)'}`, borderRadius: 8,
      background: 'var(--paper)', color: meta ? 'var(--ink-2)' : 'var(--accent-alarm)',
      cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13,
    }}>
      <LED status={meta ? 'ok' : 'pending'} size={7} />
      {meta
        ? <span className="mono" style={{ fontSize: 12 }}>{meta.model}{meta.serial && ` · ${meta.serial.slice(-6)}`}</span>
        : 'Connect instrument'}
    </button>
  );
}

export function ToolboxScreen() {
  const { params, paused, liveSpectrum, setCursor } = useAcqStore();
  const { captures, selectedIds } = useSessionStore();
  const setExportOpen = useUIStore(s => s.setExportOpen);
  // Only the user-selected captures are overlaid, so the default view is one clean live trace.
  const overlay = captures.filter(c => selectedIds.includes(c.id));

  return (
    <div className="toolbox">
      <MenuBar />

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        padding: '8px 16px', borderBottom: '1px solid var(--line)' }}>
        <ConnectionChip />
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
        <div style={{ flex: 1, minWidth: 0 }}><ModeStrip /></div>
        <button onClick={() => setExportOpen(true)} disabled={captures.length === 0}
          title={captures.length ? 'Export captures' : 'No captures to export'} style={{
            padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 8, flexShrink: 0,
            background: 'var(--paper)', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontSize: 13,
            cursor: captures.length ? 'pointer' : 'not-allowed', opacity: captures.length ? 1 : 0.5,
          }}>Export…</button>
      </div>

      <main className="toolbox-body">
        <section className="toolbox-col toolbox-left" aria-label="Instrument and acquisition">
          <InstrumentCard />
          <ActionShelf />
        </section>

        <section className="toolbox-col toolbox-center" aria-label="Spectrum">
          <LiveSpectrum
            params={params}
            captures={overlay}
            liveSpectrum={liveSpectrum}
            onCursor={setCursor}
            paused={paused}
          />
        </section>

        <section className="toolbox-col toolbox-right toolbox-panel" aria-label="Captures">
          <CaptureContextPanel />
        </section>
      </main>

      <StatusBar />
    </div>
  );
}
