import { useUIStore } from '../../store/uiStore';
import type { ToastKind } from '../../store/uiStore';

const STYLES: Record<ToastKind, { border: string; bg: string; fg: string; icon: string }> = {
  error:   { border: 'rgba(192,50,45,0.4)',  bg: 'rgba(192,50,45,0.06)',  fg: 'var(--accent-alarm)', icon: '⚠' },
  success: { border: 'rgba(31,157,85,0.4)',  bg: 'rgba(31,157,85,0.06)',  fg: 'var(--accent-ok)',    icon: '✓' },
  info:    { border: 'var(--line)',           bg: 'var(--paper)',          fg: 'var(--ink-2)',        icon: 'ℹ' },
};

export function Toaster() {
  const { toasts, dismissToast } = useUIStore();
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 200,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380,
    }}>
      {toasts.map(t => {
        const s = STYLES[t.kind];
        return (
          <div key={t.id} onClick={() => dismissToast(t.id)} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 12px', borderRadius: 10,
            border: `1px solid ${s.border}`, background: s.bg,
            boxShadow: '0 12px 32px -12px rgba(15,17,21,0.3)',
            cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: s.fg, fontWeight: 600, flexShrink: 0 }}>{s.icon}</span>
            <span style={{ flex: 1, lineHeight: 1.4, color: s.fg }}>{t.message}</span>
            <span style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</span>
          </div>
        );
      })}
    </div>
  );
}
