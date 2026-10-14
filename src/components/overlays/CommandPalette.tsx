import { useState } from 'react';
import { useUIStore }       from '../../store/uiStore';
import { buildMenus }       from '../layout/menus';
import { useSessionStore }  from '../../store/sessionStore';

interface CmdItem {
  group: string;
  label: string;
  meta?: string;
  action: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const { setCmdOpen } = useUIStore();
  const { sessions, setActiveSession } = useSessionStore();

  function close() { setCmdOpen(false); setQuery(''); }

  const allItems: CmdItem[] = [
    ...sessions.slice(0, 5).map(s => ({
      group: 'Workspace', label: s.name, meta: `${s.captureCount} spectra`,
      action: () => { setActiveSession(s.id); close(); },
    })),
    // The menu bar's commands, enabled ones only.
    ...buildMenus().flatMap(m => m.items.flatMap(it => it === '-' || !it.action ? [] : [{
      group: m.name, label: it.label, meta: it.shortcut ?? '',
      action: () => { close(); it.action!(); },
    }])),
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
          placeholder="Search workspaces and commands…"
          style={{ padding: '14px 18px', border: 0, outline: 0,
            background: 'transparent', color: 'var(--ink)',
            fontSize: 'var(--text-lg)',
            borderBottom: '1px solid var(--line)' }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--muted)', textAlign: 'center', fontSize: 'var(--text-base)' }}>
              No results for "{query}"
            </div>
          ) : filtered.map((item, i) => (
            <button key={i} onClick={item.action} style={{
              display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 14, alignItems: 'center',
              padding: '8px 12px', borderRadius: 8, border: 0, background: 'transparent',
              cursor: 'pointer', width: '100%', textAlign: 'left', }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {item.group}
              </span>
              <span style={{ fontSize: 'var(--text-base)', color: 'var(--ink)' }}>{item.label}</span>
              {item.meta && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{item.meta}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
