import { useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { WORKSPACES }    from '../../lib/features';

export function WorkspaceRail() {
  const { sessions, activeId, setActiveSession, deleteSession } = useSessionStore();
  const { activeWs, setWorkspace, setNewSessionOpen } = useUIStore();
  const [hoverId, setHoverId] = useState<string | null>(null);

  function onDelete(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (confirm(`Delete session "${name}"? This removes its captures from the local database.`)) {
      deleteSession(id);
    }
  }

  return (
    <nav style={{
      flex: '0 0 220px', borderRight: '1px solid var(--line)', background: 'var(--bg)',
      overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {/* Workspaces */}
      <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.12em', color: 'var(--muted)', padding: '12px 10px 6px' }}>
        Workspaces
      </div>
      {WORKSPACES.map(ws => (
        <button key={ws.id} onClick={() => setWorkspace(ws.id)} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
          borderRadius: 8, border: 0,
          background: activeWs === ws.id ? 'var(--tint)' : 'transparent',
          color: activeWs === ws.id ? 'var(--ink)' : 'var(--ink-2)',
          cursor: 'pointer', textAlign: 'left', fontSize: 13,
          fontFamily: 'var(--font-sans)', width: '100%',
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
            background: activeWs === ws.id ? 'var(--signal)' : 'var(--line-2)',
          }} />
          {ws.label}
        </button>
      ))}

      {/* Sessions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 10px 6px' }}>
        <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: 'var(--muted)' }}>Sessions</span>
        <button onClick={() => setNewSessionOpen(true)} style={{
          width: 18, height: 18, border: '1px solid var(--line)', borderRadius: 6,
          background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer',
          fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}>+</button>
      </div>

      {sessions.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 10px' }}>
          No sessions yet — click + to create one.
        </div>
      )}

      {sessions.map(s => (
        <div key={s.id}
          onClick={() => setActiveSession(s.id)}
          onMouseEnter={() => setHoverId(s.id)}
          onMouseLeave={() => setHoverId(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
            borderRadius: 8,
            background: s.id === activeId ? 'var(--tint)' : 'transparent',
            color: s.id === activeId ? 'var(--ink)' : 'var(--ink-2)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)', width: '100%',
          }}>
          <span style={{
            width: 14, height: 14, borderRadius: 2, flexShrink: 0,
            border: `1px solid ${s.id === activeId ? 'var(--accent-ok)' : 'var(--line-2)'}`,
            background: s.id === activeId ? 'rgba(31,157,85,0.18)' : 'transparent',
          }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
              {s.captureCount} captures{s.operator ? ` · ${s.operator}` : ''}
            </span>
          </span>
          {hoverId === s.id && sessions.length > 1 && (
            <button
              onClick={e => onDelete(s.id, s.name, e)}
              title="Delete session"
              style={{
                width: 18, height: 18, border: 0, borderRadius: 5,
                background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                fontSize: 14, lineHeight: 1, flexShrink: 0, padding: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-alarm)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; }}
            >×</button>
          )}
        </div>
      ))}
    </nav>
  );
}
