export function KbdHint({ keys }: { keys: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10,
      padding: '1px 5px', borderRadius: 4,
      background: 'var(--tint-2)', color: 'var(--muted)',
      border: '1px solid var(--line)',
    }}>{keys}</span>
  );
}
