import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { ipc }             from '../../lib/ipc';
import { buildMenus, type Menu } from './menus';

/** A dropdown anchored under its button. Closes on outside click and Escape. */
function Dropdown({ anchor, onClose, children }: {
  anchor: DOMRect; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Next tick, so the click that opened the menu does not close it again.
    const t = setTimeout(() => window.addEventListener('mousedown', down));
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" style={{
      position: 'fixed', top: anchor.bottom + 4, left: Math.min(anchor.left, window.innerWidth - 280),
      minWidth: 240, maxWidth: 320, padding: 5, zIndex: 90,
      background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 10,
      boxShadow: '0 12px 32px -8px rgba(15,17,21,0.3)',
    }}>{children}</div>
  );
}

const itemStyle = (enabled: boolean): React.CSSProperties => ({
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, width: '100%',
  padding: '7px 10px', border: 0, borderRadius: 6, background: 'transparent', textAlign: 'left',
  fontFamily: 'var(--font-sans)', fontSize: 13, color: enabled ? 'var(--ink)' : 'var(--muted)',
  cursor: enabled ? 'pointer' : 'not-allowed',
});
const hover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--signal-soft)'; },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent'; },
};
const rule = <div style={{ height: 1, background: 'var(--line)', margin: '4px 2px' }} />;

/** The open workspace, always visible; click to switch, create or delete one.
 *  A workspace is what the code calls a Session. */
function WorkspaceSwitcher() {
  const { sessions, activeId, captures, setActiveSession, deleteSession, activeSession } = useSessionStore();
  const setNewSessionOpen = useUIStore(s => s.setNewSessionOpen);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const current = activeSession();
  const close = () => setAnchor(null);

  // The window title names the workspace too, so it shows in the taskbar.
  useEffect(() => { document.title = current ? `${current.name} — JASPER` : 'JASPER'; }, [current]);

  async function remove() {
    close();
    if (!current) return;
    if (await ipc.confirm(`Delete workspace "${current.name}"? This removes its captures from the local database.`)) {
      deleteSession(current.id);
    }
  }

  return (
    <>
      <button onClick={e => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
        title="Switch workspace" aria-haspopup="menu" style={{
          display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: 360, height: 32,
          padding: '0 10px 0 6px', border: '1px solid var(--line-2)', borderRadius: 8,
          background: 'var(--paper)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        }}>
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--signal)', background: 'var(--signal-soft)',
          padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>Workspace</span>
        <b style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name ?? 'None'}
        </b>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {captures.length} spectra
        </span>
        <span aria-hidden style={{ color: 'var(--muted)', fontSize: 10 }}>▾</span>
      </button>
      {anchor && (
        <Dropdown anchor={anchor} onClose={close}>
          {sessions.map(s => (
            <button key={s.id} {...hover} style={itemStyle(true)}
              onClick={() => { close(); setActiveSession(s.id); }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontWeight: s.id === activeId ? 600 : 400 }}>
                {s.id === activeId ? '✓ ' : ''}{s.name}
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                {s.id === activeId ? captures.length : s.captureCount}
              </span>
            </button>
          ))}
          {rule}
          <button {...hover} style={itemStyle(true)} onClick={() => { close(); setNewSessionOpen(true); }}>
            New workspace…
          </button>
          <button {...hover} disabled={sessions.length <= 1} style={itemStyle(sessions.length > 1)}
            title={sessions.length <= 1 ? 'The last workspace cannot be deleted' : undefined}
            onClick={remove}>
            Delete this workspace…
          </button>
        </Dropdown>
      )}
    </>
  );
}

export function MenuBar() {
  const { theme, setTheme, setCmdOpen } = useUIStore();
  const [open, setOpen] = useState<{ menu: Menu; anchor: DOMRect } | null>(null);
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <header style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px',
      padding: '6px 16px', minHeight: 46, borderBottom: '1px solid var(--line)', background: 'var(--paper)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>JASPER</span>
        <img src="/checkag.png" alt="CheckAg" style={{ height: 16, width: 'auto', display: 'block' }} />
      </div>

      <nav aria-label="Main menu" style={{ display: 'flex', gap: 2, minWidth: 0, overflowX: 'auto' }}>
        {buildMenus().map(m => (
          <button key={m.name} aria-haspopup="menu"
            onClick={e => {
              const anchor = e.currentTarget.getBoundingClientRect();
              // Rebuilt on open: labels and enabled states follow the current state.
              setOpen(open?.menu.name === m.name ? null : { menu: buildMenus().find(x => x.name === m.name)!, anchor });
            }}
            style={{
              padding: '5px 10px', border: 0, borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
              background: open?.menu.name === m.name ? 'var(--tint)' : 'transparent',
              color: open?.menu.name === m.name ? 'var(--ink)' : 'var(--ink-2)',
              fontFamily: 'var(--font-sans)', fontSize: 13,
            }}>{m.name}</button>
        ))}
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <WorkspaceSwitcher />
        <button onClick={() => setTheme(next)} title={`Switch to ${next} theme`} aria-label={`Switch to ${next} theme`}
          style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', padding: 0, flexShrink: 0,
            border: '1px solid var(--line-2)', borderRadius: 8, background: 'var(--paper)',
            color: 'var(--ink-2)', cursor: 'pointer' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {theme === 'dark'
              ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
              : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
          </svg>
        </button>
        <button onClick={() => setCmdOpen(true)} title="Search commands" style={{
          height: 32, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 8, flexShrink: 0,
          background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11,
        }}>⌘K</button>
      </div>

      {open && (
        <Dropdown anchor={open.anchor} onClose={() => setOpen(null)}>
          {open.menu.items.map((it, i) => it === '-' ? <div key={i}>{rule}</div> : (
            <button key={it.label} role="menuitem" {...hover} disabled={!it.action}
              title={!it.action ? it.hint : undefined} style={itemStyle(!!it.action)}
              onClick={() => { setOpen(null); it.action?.(); }}>
              <span>{it.label}</span>
              {it.shortcut && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{it.shortcut}</span>}
            </button>
          ))}
        </Dropdown>
      )}
    </header>
  );
}
