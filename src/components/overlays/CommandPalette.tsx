import { useState } from 'react';
import { useUIStore }       from '../../store/uiStore';
import { WORKSPACES }    from '../../lib/features';
import { useSessionStore }  from '../../store/sessionStore';

interface CmdItem {
  group: string;
  label: string;
  meta?: string;
  action: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const { setCmdOpen, setWorkspace, setExportOpen, setNewSessionOpen } = useUIStore();
  const { sessions, setActiveSession } = useSessionStore();

  function close() { setCmdOpen(false); setQuery(''); }

  const allItems: CmdItem[] = [
    ...WORKSPACES.map(ws => ({
      group: 'Workspace', label: ws.label, meta: '↵',
      action: () => { setWorkspace(ws.id); close(); },
    })),
    ...sessions.slice(0, 5).map(s => ({
      group: 'Session', label: s.name, meta: `${s.captureCount} captures`,
      action: () => { setActiveSession(s.id); close(); },
    })),
    { group: 'Action', label: 'New session', meta: '',
      action: () => { setNewSessionOpen(true); close(); } },
    { group: 'Action', label: 'Export data', meta: '',
      action: () => { setExportOpen(true); close(); } },
  ];

  const filtered = query.trim()
    ? allItems.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
    : allItems;

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.32)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh', zIndex: 100, backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxWidth: '90vw', background: 'var(--paper)', color: 'var(--ink)',
        border: '1px solid var(--line)', borderRadius: 14,
        boxShadow: '0 30px 80px -20px rgba(15,17,21,0.45)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search workspaces, sessions, actions…"
          style={{ padding: '14px 18px', border: 0, outline: 0,
            background: 'transparent', color: 'var(--ink)',
            fontFamily: 'var(--font-sans)', fontSize: 18,
            borderBottom: '1px solid var(--line)' }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
              No results for "{query}"
            </div>
          ) : filtered.map((item, i) => (
            <button key={i} onClick={item.action} style={{
              display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 14, alignItems: 'center',
              padding: '8px 12px', borderRadius: 8, border: 0, background: 'transparent',
              cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'var(--font-sans)',
            }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {item.group}
              </span>
              <span style={{ fontSize: 14, color: 'var(--ink)' }}>{item.label}</span>
              {item.meta && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{item.meta}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
