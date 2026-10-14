interface MonoReadoutProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  deltaUp?: boolean;
}

export function MonoReadout({ label, value, unit, delta, deltaUp }: MonoReadoutProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--muted)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', letterSpacing: '-0.02em', color: 'var(--ink)',
      }}>
        {value}
        {unit && <small style={{ fontSize: 'var(--text-base)', color: 'var(--muted)', marginLeft: 3 }}>{unit}</small>}
      </span>
      {delta && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          color: deltaUp ? 'var(--accent-warn)' : 'var(--accent-ok)',
        }}>{delta}</span>
      )}
    </div>
  );
}
