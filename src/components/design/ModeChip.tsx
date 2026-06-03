interface ModeChipProps {
  label: string;
  kbd?: string;
  active: boolean;
  onClick: () => void;
}

export function ModeChip({ label, kbd, active, onClick }: ModeChipProps) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line)',
      background: active ? 'var(--ink)' : 'var(--paper)',
      color: active ? 'var(--paper)' : 'var(--ink-2)',
      cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
    }}>
      {label}
      {kbd && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          padding: '1px 5px', borderRadius: 4,
          background: active ? 'rgba(255,255,255,0.18)' : 'var(--tint)',
          color: active ? 'var(--paper)' : 'var(--muted)',
          border: '1px solid transparent',
        }}>{kbd}</span>
      )}
    </button>
  );
}
