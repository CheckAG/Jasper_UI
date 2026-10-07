import { useSessionStore } from '../../store/sessionStore';
import { ipc }             from '../../lib/ipc';

export function CaptureContextPanel() {
  const { captures, selectedIds, removeCapture, toggleSelected } = useSessionStore();

  return (
    <>
      {/* Captures */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h5 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>
          Captures ({captures.length})
        </h5>
        {captures.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Press <kbd className="mono" style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4,
              border: '1px solid var(--line)', background: 'var(--tint)' }}>Space</kbd> to capture
          </span>
        )}
        {captures.slice().reverse().map(cap => {
          const selected = selectedIds.includes(cap.id);
          return (
            <div key={cap.id}
              onClick={() => toggleSelected(cap.id)}
              onContextMenu={async e => {
                e.preventDefault();
                if (await ipc.confirm(`Delete capture "${cap.label}"? This removes it from the local database.`)) {
                  removeCapture(cap.id);
                }
              }}
              title="Click to overlay on the plot · right-click to remove"
              style={{ display: 'flex', gap: 10, alignItems: 'center',
                padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${selected ? 'var(--signal)' : 'transparent'}`,
                background: selected ? 'var(--signal-soft)' : 'transparent' }}>
              {/* color swatch (filled when selected) */}
              <div style={{ width: 48, height: 26, flexShrink: 0, borderRadius: 4,
                background: selected ? cap.color : 'var(--paper)',
                opacity: selected ? 0.9 : 1,
                border: '1px solid var(--line)',
                borderLeft: `3px solid ${cap.color}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{cap.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {new Date(cap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{cap.params.mode}</span>
                  {cap.tag && <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{cap.tag}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {captures.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--muted)', paddingLeft: 8, marginTop: 2 }}>
            Click to overlay · right-click to remove
          </span>
        )}
      </div>
    </>
  );
}
