import { useAcqStore }        from '../../store/acqStore';
import { useSessionStore }    from '../../store/sessionStore';
import { LiveSpectrum }       from '../../spectrum/LiveSpectrum';
import { WorkspaceShell }     from '../../components/layout/WorkspaceShell';
import { ModeStrip }          from './ModeStrip';
import { ActionShelf }        from './ActionShelf';
import { CaptureContextPanel }from './CaptureContextPanel';

export function AcquireWorkspace() {
  const { params, paused, liveSpectrum, setCursor } = useAcqStore();
  const { captures, selectedIds } = useSessionStore();

  // Only the user-selected captures are overlaid on the canvas (keeps the
  // default view a single clean live trace).
  const overlay = captures.filter(c => selectedIds.includes(c.id));

  return (
    <WorkspaceShell
      canvas={
        <>
          <ModeStrip />
          <LiveSpectrum
            params={params}
            captures={overlay}
            theme="light"
            liveSpectrum={liveSpectrum}
            onCursor={setCursor}
            paused={paused}
          />
          <ActionShelf />
        </>
      }
      context={<CaptureContextPanel />}
    />
  );
}
