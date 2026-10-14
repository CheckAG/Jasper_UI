import { useAcqStore }     from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { ipc }             from '../../lib/ipc';

export interface MenuItem {
  label:     string;
  shortcut?: string;
  action?:   () => void;    // absent = disabled
  hint?:     string;        // why it is disabled
}
export interface Menu { name: string; items: (MenuItem | '-')[] }

/** Every command in the app, grouped as the menu bar shows them. Built from the
 *  stores' current state each time a menu (or the ⌘K palette) opens, so labels
 *  and enabled states are never stale. The palette lists the same items. */
export function buildMenus(): Menu[] {
  const acq = useAcqStore.getState();
  const ui  = useUIStore.getState();
  const ses = useSessionStore.getState();
  const connected = acq.deviceMeta !== null;
  const hasCaptures = ses.captures.length > 0;
  const needDevice = 'Connect an instrument first';

  return [
    { name: 'File', items: [
      { label: 'New workspace…', action: () => ui.setNewSessionOpen(true) },
      '-',
      { label: 'Export…', action: hasCaptures ? () => ui.setExportOpen(true) : undefined, hint: 'No captures yet' },
    ]},
    { name: 'Device', items: [
      { label: 'Instruments…', action: () => ui.setDialog('instruments') },
      { label: 'Disconnect', action: connected
          ? () => { ipc.disconnectDevice().then(acq.refreshInstrument).catch(e => ui.pushToast(String(e), 'error')); }
          : undefined, hint: 'No instrument connected' },
      '-',
      { label: 'Firmware update…', action: () => ui.setDialog('firmware') },
      { label: 'Diagnostics', action: () => ui.setDialog('diagnostics') },
    ]},
    { name: 'Acquire', items: [
      { label: acq.paused ? 'Go live' : 'Freeze', shortcut: 'L',
        action: connected ? () => acq.setPaused(!acq.paused) : undefined, hint: needDevice },
      { label: 'Capture', shortcut: 'Space',
        action: connected && acq.paused ? () => { acq.runCapture(); } : undefined,
        hint: connected ? 'Freeze first' : needDevice },
      { label: 'Burst capture…', action: connected ? () => ui.setDialog('burst') : undefined, hint: needDevice },
      { label: 'Settings profiles…', action: () => ui.setDialog('profiles') },
      '-',
      { label: acq.calHeld.dark ? 'Remove dark' : 'Take dark', shortcut: 'D',
        action: acq.calHeld.dark || acq.liveSpectrum ? () => { acq.toggleCal('dark'); } : undefined,
        hint: 'No spectrum on the plot yet' },
      { label: acq.calHeld.reference ? 'Remove reference' : 'Take reference', shortcut: 'R',
        action: acq.calHeld.reference || acq.liveSpectrum ? () => { acq.toggleCal('reference'); } : undefined,
        hint: 'No spectrum on the plot yet' },
      '-',
      { label: acq.params.stack ? 'Overlay traces' : 'Stack traces',
        action: () => acq.setParam('stack', !acq.params.stack) },
      { label: ses.selectedIds.length ? 'Hide all captures' : 'Show all captures',
        action: hasCaptures ? () => {
          if (ses.selectedIds.length) ses.clearSelected();
          else ses.captures.forEach(c => ses.toggleSelected(c.id));
        } : undefined, hint: 'No captures yet' },
    ]},
    { name: 'Calibrate', items: [
      { label: 'X-axis calibration…', action: () => ui.setDialog('xcal') },
    ]},
    { name: 'View', items: [
      { label: ui.theme === 'dark' ? 'Light theme' : 'Dark theme',
        action: () => ui.setTheme(ui.theme === 'dark' ? 'light' : 'dark') },
      '-',
      { label: 'Density: comfortable', action: () => ui.setDensity('comfort') },
      { label: 'Density: standard',    action: () => ui.setDensity('standard') },
      { label: 'Density: compact',     action: () => ui.setDensity('lab') },
    ]},
    { name: 'Help', items: [
      { label: 'Command palette', shortcut: '⌘K', action: () => ui.setCmdOpen(true) },
      { label: 'Keyboard shortcuts', action: () => ui.setDialog('shortcuts') },
    ]},
  ];
}
