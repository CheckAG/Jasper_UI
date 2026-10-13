import { useEffect }       from 'react';
import { useAcqStore }     from './store/acqStore';
import { useSessionStore } from './store/sessionStore';
import { useUIStore }      from './store/uiStore';
import { ipc }             from './lib/ipc';
import { ToolboxScreen }         from './components/layout/ToolboxScreen';
import { DeviceDialogs }         from './components/overlays/InstrumentDialogs';
import { CommandPalette }        from './components/overlays/CommandPalette';
import { ExportDialog }          from './components/overlays/ExportDialog';
import { NewSessionDialog }      from './components/overlays/NewSessionDialog';
import { Toaster }               from './components/overlays/Toaster';
import { ConfirmRequests }       from './components/overlays/ConfirmRequests';

export default function App() {
  // Live, integration and averaging live in the backend (Device API); the
  // store mirrors them, polled below. Nothing here starts or restarts a stream.
  const { paused, setPaused, setLiveSpectrum } = useAcqStore();
  const { init: initSessions } = useSessionStore();
  const { density, cmdOpen, exportOpen, newSessionOpen, setCmdOpen } = useUIStore();

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
    });
    // A capture by any caller lands in the Captures panel. The GUI's own capture
    // also arrives through runCapture; the store ignores the second copy.
    const unlistenSaved = ipc.onCaptureSaved((sessionId, id) => {
      const s = useSessionStore.getState();
      if (sessionId === s.activeId && s.captures.some(c => c.id === id)) return;
      s.syncCaptures(sessionId).catch(() => {});
    });
    return () => {
      clearInterval(instrumentPoll);
      unlisten();
      unlistenSaved();
      ipc.stopAcquisition().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (e.key === 'l')       setPaused(!paused);
      if (e.key === 'd')       useAcqStore.getState().toggleCal('dark');
      if (e.key === 'r')       useAcqStore.getState().toggleCal('reference');
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      if (e.key === 'Escape')  setCmdOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paused, setPaused, setCmdOpen]);

  return (
    <>
      {/* One screen. Analyze and Chemometrics are not rendered (features.ts). */}
      <ToolboxScreen />
      <DeviceDialogs />

      {cmdOpen        && <CommandPalette />}
      {exportOpen     && <ExportDialog />}
      {newSessionOpen && <NewSessionDialog />}
      <ConfirmRequests />
      <Toaster />
    </>
  );
}
