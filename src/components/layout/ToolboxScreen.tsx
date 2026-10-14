import { useEffect, useState } from 'react';
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
import { StatusBar, SATURATION_WARN } from './StatusBar';
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
      cursor: 'pointer', fontSize: 'var(--text-base)',
    }}>
      <LED status={meta ? 'ok' : 'pending'} size={7} />
      {meta
        ? <span className="mono" style={{ fontSize: 'var(--text-md)' }}>{meta.model}{meta.serial && ` · ${meta.serial.slice(-6)}`}</span>
        : 'Connect instrument'}
    </button>
  );
}

/** Warnings about the trace on the plot: saturation, and a dark that no longer matches. */
function PlotBanners() {
  const peak = useAcqStore(s => s.liveSpectrum?.peak);
  const darkStale = useAcqStore(s => s.darkStale);
  // The stale-dark notice is a heads-up, not a state: it shows for 5 s each
  // time the dark goes stale, then gets out of the way.
  const [staleShown, setStaleShown] = useState(false);
  useEffect(() => {
    setStaleShown(darkStale);
    if (!darkStale) return;
    const t = setTimeout(() => setStaleShown(false), 5000);
    return () => clearTimeout(t);
  }, [darkStale]);
  const banners: string[] = [];
  if (peak !== undefined && peak >= SATURATION_WARN)
    banners.push(`Saturated: peak at ${Math.round(peak * 100)}% of full scale. Shorten the integration time.`);
  if (staleShown)
    banners.push('Integration or averaging changed since the dark was taken. Take a new dark.');
  if (!banners.length) return null;
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {banners.map(b => (
        <div key={b} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 'var(--text-base)',
          border: '1px solid var(--accent-warn)', color: 'var(--accent-warn)', background: 'var(--paper)' }}>{b}</div>
      ))}
    </div>
  );
}

export function ToolboxScreen() {
  const { params, paused, liveSpectrum, setCursor } = useAcqStore();
  const { captures, selectedIds } = useSessionStore();
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
      </div>

      <main className="toolbox-body">
        <section className="toolbox-col toolbox-left" aria-label="Instrument and acquisition">
          <InstrumentCard />
          <ActionShelf />
        </section>

        <section className="toolbox-col toolbox-center" aria-label="Spectrum">
          <PlotBanners />
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
