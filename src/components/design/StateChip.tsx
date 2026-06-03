import type { CalStatus } from '../../lib/types';
import { LED } from './LED';

interface StateChipProps {
  status: CalStatus | 'live' | 'idle';
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export function StateChip({ status, label, active, onClick }: StateChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 8, cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-mono)', fontSize: 12,
        border: active ? '1px solid var(--signal)' : '1px solid var(--line)',
        background: active ? 'var(--signal-soft)' : 'var(--paper)',
        color: active ? 'var(--signal)' : 'var(--ink-2)',
      }}
    >
      <LED status={status} />
      {label}
    </button>
  );
}
