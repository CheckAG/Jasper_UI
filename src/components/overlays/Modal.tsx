import { useEffect, type ReactNode } from 'react';

/** Centred dialog over a scrim. Closes on Escape and on a click outside. */
export function Modal({ title, subtitle, width = 520, onClose, children }: {
  title:     string;
  subtitle?: string;
  width?:    number;
  onClose:   () => void;
  children:  ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 100, backdropFilter: 'blur(4px)',
    }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} style={{
        width, maxWidth: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column',
        background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 14,
        boxShadow: '0 30px 80px -20px rgba(15,17,21,0.45)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px',
          borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h4>
            {subtitle && <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>{subtitle}</span>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 28, height: 28, border: '1px solid var(--line)', borderRadius: 8,
            background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer', fontSize: 'var(--text-lg)', lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
