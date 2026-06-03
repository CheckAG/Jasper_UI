interface ToggleProps {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ on, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8,
        background: 'var(--paper)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 26, height: 14, borderRadius: 99, position: 'relative',
        background: on ? 'var(--signal)' : 'var(--tint-2)', transition: 'background 0.18s',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 1, left: on ? 13 : 1,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--paper)', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
          transition: 'left 0.18s',
        }} />
      </span>
      {label && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>
          {label}
        </span>
      )}
    </button>
  );
}
