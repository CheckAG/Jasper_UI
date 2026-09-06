import { useEffect }       from 'react';
import { useAcqStore }     from './store/acqStore';
import { useSessionStore } from './store/sessionStore';
import { useUIStore }      from './store/uiStore';
import { ipc }             from './lib/ipc';
import { isWorkspaceEnabled, DEFAULT_WORKSPACE } from './lib/features';
import { sampleCapture }   from './lib/mockDriver';
import { AcquireWorkspace }      from './workspaces/acquire/AcquireWorkspace';
import { InstrumentWorkspace }   from './workspaces/instrument/InstrumentWorkspace';
import { AnalyzeWorkspace }      from './workspaces/analyze/AnalyzeWorkspace';
import { ChemometricsWorkspace } from './workspaces/chemometrics/ChemometricsWorkspace';
import { CommandPalette }        from './components/overlays/CommandPalette';
import { ExportDialog }          from './components/overlays/ExportDialog';
import { NewSessionDialog }      from './components/overlays/NewSessionDialog';
import { Toaster }               from './components/overlays/Toaster';

/** Snapshot whatever the canvas is currently showing — the real live frame if
 *  streaming, else a fresh mock frame that matches the current params. */
function captureCurrentFrame(): { xs: Float32Array; ys: Float32Array } {
  const { liveSpectrum, params } = useAcqStore.getState();
  return liveSpectrum ?? sampleCapture(params, performance.now() / 1000);
}

export default function App() {
  const { params, paused, setParam, setPaused, setLiveSpectrum } = useAcqStore();
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
    const unlisten = ipc.onSpectrumFrame(setLiveSpectrum);
    return () => {
      unlisten();
      ipc.stopAcquisition().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)start the acquisition stream whenever acquisition params change, so the
  // streamed trace matches the selected mode / integration / averaging.
  useEffect(() => {
    ipc.startAcquisition(params).catch(() => {/* non-Tauri: canvas uses local mock */});
  }, [params.mode, params.integration, params.averaging, params.lightOn, params.lightPower]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        const f = captureCurrentFrame();
        addCapture(useAcqStore.getState().params, f.xs, f.ys, '');
      }
      if (e.key === 'a')       setParam('mode', 'absorbance');
      if (e.key === 'r')       setParam('mode', 'reflectance');
      if (e.key === 't')       setParam('mode', 'transmittance');
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
