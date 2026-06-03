import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'cta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

const styles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)',
    boxShadow: '0 2px 8px -4px rgba(15,17,21,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
  },
  ghost: {
    background: 'var(--paper)', color: 'var(--ink-2)', border: '1px solid var(--line)',
  },
  danger: {
    background: 'var(--paper)', color: 'var(--accent-alarm)', border: '1px solid var(--line)',
  },
  cta: {
    background: 'var(--ink)', color: 'var(--paper)', border: 0,
    boxShadow: '0 6px 16px -8px rgba(15,17,21,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
  },
};

export function Button({ variant = 'ghost', size = 'md', style, children, ...rest }: ButtonProps) {
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: size === 'sm' ? '4px 10px' : '7px 14px',
        borderRadius: size === 'sm' ? 6 : 9,
        fontFamily: 'var(--font-sans)', fontSize: size === 'sm' ? 12 : 13, fontWeight: 500,
        cursor: 'pointer', letterSpacing: '-0.005em', transition: 'opacity 0.1s',
        ...styles[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
