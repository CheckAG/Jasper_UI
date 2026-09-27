import { useEffect }       from 'react';
import { useAcqStore }     from './store/acqStore';
import { useSessionStore } from './store/sessionStore';
import { useUIStore }      from './store/uiStore';
import { ipc }             from './lib/ipc';
import { isWorkspaceEnabled, DEFAULT_WORKSPACE } from './lib/features';
import { AcquireWorkspace }      from './workspaces/acquire/AcquireWorkspace';
import { InstrumentWorkspace }   from './workspaces/instrument/InstrumentWorkspace';
import { AnalyzeWorkspace }      from './workspaces/analyze/AnalyzeWorkspace';
import { ChemometricsWorkspace } from './workspaces/chemometrics/ChemometricsWorkspace';
import { CommandPalette }        from './components/overlays/CommandPalette';
import { ExportDialog }          from './components/overlays/ExportDialog';
import { NewSessionDialog }      from './components/overlays/NewSessionDialog';
import { Toaster }               from './components/overlays/Toaster';

export default function App() {
  const { params, paused, setParam, setPaused, setLiveSpectrum } = useAcqStore();
  // Whether a device is connected, from the backend — the stream cannot start
  // before one is. Serial rather than the object: the poller hands back a new
  // object every 2 s, and depending on that would restart the stream on a timer.
  const deviceSerial = useAcqStore(s => s.deviceMeta?.serial ?? null);
  const { addCapture, init: initSessions } = useSessionStore();
  const { density, activeWs, cmdOpen, exportOpen, newSessionOpen, setCmdOpen, setWorkspace } = useUIStore();

  // A workspace that has since been switched off must not stay selected —
  // otherwise it renders with no way in the rail to leave it.
  useEffect(() => {
    if (!isWorkspaceEnabled(activeWs)) setWorkspace(DEFAULT_WORKSPACE);
  }, [activeWs, setWorkspace]);

  // One-time init: density, session hydration, live-frame subscription
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    initSessions();
    // One poller for instrument state, shared by the top bar, the Instrument
    // panel and the Acquire strip.
    const { refreshInstrument } = useAcqStore.getState();
    refreshInstrument();
    const instrumentPoll = setInterval(refreshInstrument, 2000);

    const unlisten = ipc.onSpectrumFrame(frame => {
      // A frame already in flight when the stream was stopped must not land
      // after the freeze: what is captured has to be what is on screen.
      if (useAcqStore.getState().paused) return;
      setLiveSpectrum(frame);
      // Report the frame rendered on the next paint, which is when it actually
      // reaches the canvas. Until this lands the backend holds off capturing,
      // so a slow render costs frame rate instead of accumulating a backlog.
      requestAnimationFrame(() => { ipc.frameConsumed().catch(() => {}); });

      // The device clamps integration to its own range and reports what it
      // applied. Snap the control to the truth rather than leaving it showing a
      // value the hardware refused. Converges in one step: the next frame comes
      // back with the value we now hold.
      const applied = frame.params.integration;
      const { params: current, setParam: set } = useAcqStore.getState();
      if (applied > 0 && applied !== current.integration) set('integration', applied);
    });
    return () => {
      clearInterval(instrumentPoll);
      unlisten();
      ipc.stopAcquisition().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start and stop the stream with Live, and restart it whenever acquisition
  // params change so the trace matches the settings. Pausing stops the device
  // capturing rather than just hiding the result — the instrument has nothing
  // to do while the plot is frozen.
  //
  // Connecting a device is also a start condition. This used to depend on
  // `paused` alone: at launch it ran once with nothing connected, the start
  // threw and was swallowed, and connecting afterwards never re-ran it — Live
  // read as on while no frame was ever emitted.
  useEffect(() => {
    if (paused || !deviceSerial) {
      ipc.stopAcquisition().catch(() => {});
    } else {
      ipc.startAcquisition(params).catch(() => {/* no instrument: canvas stays empty */});
    }
  }, [paused, deviceSerial, params.mode, params.integration, params.averaging]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        // Same routine as the Capture button, rather than a second way to take
        // a capture that skipped averaging and progress entirely.
        useAcqStore.getState().runCapture();
      }
      if (e.key === 'p')       setPaused(!paused);
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      if (e.key === 'Escape')  setCmdOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paused, addCapture, setParam, setPaused, setCmdOpen]);

  return (
    <>
      {activeWs === 'acquire'      && <AcquireWorkspace />}
      {activeWs === 'instrument'   && <InstrumentWorkspace />}
      {activeWs === 'analyze'      && <AnalyzeWorkspace />}
      {activeWs === 'chemometrics' && <ChemometricsWorkspace />}

      {cmdOpen        && <CommandPalette />}
      {exportOpen     && <ExportDialog />}
      {newSessionOpen && <NewSessionDialog />}
      <Toaster />
    </>
  );
}
