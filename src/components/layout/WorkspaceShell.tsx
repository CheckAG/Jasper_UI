import type { ReactNode } from 'react';
import { TopBar }        from './TopBar';
import { WorkspaceRail } from './WorkspaceRail';
import { StatusBar }     from './StatusBar';

interface WorkspaceShellProps {
  canvas:  ReactNode;
  context: ReactNode;
}

export function WorkspaceShell({ canvas, context }: WorkspaceShellProps) {
  return (
    <div style={{
      height: '100%', display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      background: 'var(--bg)', color: 'var(--ink)',
    }}>
      <TopBar />

      <div style={{ display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <WorkspaceRail />

        {/* Canvas column */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--gap)',
          padding: 'var(--pad)', minWidth: 0, minHeight: 0, overflow: 'hidden',
          background: 'var(--bg)',
        }}>
          {canvas}
        </div>

        {/* Context rail */}
        <aside style={{
          flex: '0 0 288px', borderLeft: '1px solid var(--line)',
          background: 'var(--bg)',
          padding: '14px 12px',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          {context}
        </aside>
      </div>

      <StatusBar />
    </div>
  );
}
