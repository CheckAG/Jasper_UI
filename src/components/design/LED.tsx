import type { CalStatus } from '../../lib/types';

interface LEDProps {
  status: CalStatus | 'live' | 'idle';
  size?: number;
}

const COLOR: Record<string, string> = {
  ok:      'var(--accent-ok)',
  live:    'var(--signal)',
  pending: 'var(--accent-warn)',
  fault:   'var(--accent-alarm)',
  idle:    'var(--muted)',
};

const GLOW: Record<string, string> = {
  ok:   '0 0 0 3px rgba(31,157,85,0.18)',
  live: '0 0 0 4px rgba(31,93,255,0.18)',
  fault:'0 0 0 3px rgba(192,50,45,0.18)',
};

export function LED({ status, size = 7 }: LEDProps) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      background: COLOR[status] ?? 'var(--muted)',
      boxShadow: GLOW[status] ?? 'none',
    }} />
  );
}
