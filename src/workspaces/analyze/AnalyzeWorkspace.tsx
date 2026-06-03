import { useEffect, useState } from 'react';
import { useAnalyzeStore } from '../../store/analyzeStore';
import { useSessionStore }  from '../../store/sessionStore';
import { ipc }              from '../../lib/ipc';
import { WorkspaceShell }   from '../../components/layout/WorkspaceShell';
import { StaticChart }      from '../../spectrum/StaticChart';
import { Button }           from '../../components/design/Button';
import type { PipelineNode, NodeKind } from '../../lib/types';

// --- Node param ranges ---
const PARAM_META: Record<string, { min: number; max: number; step: number }> = {
  window: { min: 3, max: 51, step: 2 },
  poly:   { min: 0, max: 5,  step: 1 },
  deriv:  { min: 0, max: 4,  step: 1 },
  order:  { min: 1, max: 4,  step: 1 },
};

function PipelineStrip() {
  const { pipeline, selectedNodeId, addNode, removeNode, toggleNode, setSelectedNode } = useAnalyzeStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [library, setLibrary] = useState<PipelineNode[]>([]);
  const [pluginMsg, setPluginMsg] = useState<string | null>(null);

  useEffect(() => {
    ipc.getNodeManifest().then(setLibrary);
  }, []);

  async function reloadPlugins() {
    const { loaded, nodes } = await ipc.reloadPlugins();
    if (nodes.length) setLibrary(nodes);
    setPluginMsg(`${loaded} plugin file${loaded === 1 ? '' : 's'} · ${nodes.length} nodes`);
    setTimeout(() => setPluginMsg(null), 3000);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
      {/* Raw anchor */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px',
        border: '1px solid var(--line)', borderRadius: 9, background: 'var(--tint)',
        color: 'var(--ink-2)', fontSize: 13 }}>Raw</div>

      {pipeline.map((node, idx) => (
        <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
          <button onClick={() => setSelectedNode(selectedNodeId === node.id ? null : node.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', borderRadius: 9,
              border: `1px solid ${selectedNodeId === node.id ? 'var(--signal)' : 'var(--line)'}`,
              boxShadow: selectedNodeId === node.id ? '0 0 0 3px var(--signal-soft)' : 'none',
              background: 'var(--paper)', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 13,
              color: 'var(--ink)',
              opacity: node.enabled ? 1 : 0.45,
            }}>
            <span style={{ color: 'var(--signal)', fontSize: 11 }}>{node.enabled ? '●' : '○'}</span>
            <span style={{ textDecoration: node.enabled ? 'none' : 'line-through' }}>
              {node.name}
            </span>
            {node.kind === 'sg' && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {node.params.window}·{node.params.poly}
              </span>
            )}
          </button>
        </div>
      ))}

      {/* Add node */}
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
      <div style={{ position: 'relative' }}>
        <button onClick={() => setMenuOpen(o => !o)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          border: '1px dashed var(--line-2)', borderRadius: 9, background: 'transparent',
          cursor: 'pointer', color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-sans)',
        }}>+ add</button>

        {menuOpen && (
          <div onClick={() => setMenuOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 40,
          }} />
        )}
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
            width: 240, background: 'var(--paper)', border: '1px solid var(--line)',
            borderRadius: 12, boxShadow: '0 24px 60px -24px rgba(15,17,21,0.4)', padding: 6,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {library.map(n => (
              <button key={n.kind} onClick={() => { addNode(n.kind as NodeKind); setMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', border: 0, borderRadius: 8, background: 'transparent',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13,
                  color: 'var(--ink-2)', textAlign: 'left' }}>
                {n.name}
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{n.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reload plugins + selected-node actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {pluginMsg && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{pluginMsg}</span>
        )}
        <Button size="sm" variant="ghost" onClick={reloadPlugins} title="Scan ~/jasper/plugins">
          ⟳ Plugins
        </Button>
        {selectedNodeId && (
          <>
            <Button size="sm" variant="ghost" onClick={() => toggleNode(selectedNodeId)}>
              {pipeline.find(n => n.id === selectedNodeId)?.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => removeNode(selectedNodeId)}>
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function NodeInspector() {
  const { pipeline, selectedNodeId, setNode } = useAnalyzeStore();
  const node = pipeline.find(n => n.id === selectedNodeId);
  if (!node) return (
    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Click a node to inspect its parameters</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{node.name}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{node.code}</span>
      </div>
      {Object.entries(node.params).map(([key, val]) => {
        const meta = PARAM_META[key] ?? { min: 0, max: 100, step: 1 };
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ textTransform: 'capitalize' }}>{key}</span>
              <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{val}</span>
            </div>
            <input type="range" min={meta.min} max={meta.max} step={meta.step} value={val}
              onChange={e => setNode(node.id, { params: { ...node.params, [key]: Number(e.target.value) } })}
              style={{ width: '100%', accentColor: 'var(--signal)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
              <span>{meta.min}</span><span>{meta.max}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyzeWorkspace() {
  const { pipeline, lastResult, isExecuting, setCaptureYs } = useAnalyzeStore();
  const { captures } = useSessionStore();

  useEffect(() => {
    if (captures.length > 0) {
      setCaptureYs(captures.map(c => ({ id: c.id, ys: c.ys })));
    }
  }, [captures, setCaptureYs]);

  const xs = captures[0]?.xs ?? new Float32Array(0);

  const rawSeries = captures.slice(0, 6).map(c => ({
    ys: c.ys, color: c.color, width: 1, dashed: true,
  }));

  const processedSeries = lastResult ? [{
    ys: lastResult.final, color: 'var(--signal)', width: 2,
  }] : [];

  return (
    <WorkspaceShell
      canvas={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>Analyze</div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Pre-processing Pipeline
            </h2>
          </div>

          {/* Pipeline strip */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 12,
            background: 'var(--paper)', padding: '12px 14px' }}>
            <PipelineStrip />
            {pipeline.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {isExecuting ? '⏳ Computing…' : lastResult ? `Done in ${lastResult.durationMs}ms` : ''}
                </span>
                <Button size="sm" variant="ghost">Save as method</Button>
              </div>
            )}
          </div>

          {/* Chart */}
          {captures.length > 0 ? (
            <div style={{ border: '1px solid var(--line)', borderRadius: 14,
              background: 'var(--paper)', padding: 12 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 24, height: 2, borderTop: '2px dashed var(--muted)', display: 'inline-block' }} />
                  Raw
                </span>
                {lastResult && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 24, height: 2, borderTop: '2px solid var(--signal)', display: 'inline-block' }} />
                    Processed
                  </span>
                )}
              </div>
              <StaticChart xs={xs} series={[...rawSeries, ...processedSeries]} />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 8, color: 'var(--muted)', padding: 40 }}>
              <div style={{ width: 40, height: 40, border: '2px dashed var(--line-2)', borderRadius: 10 }} />
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)' }}>No captures yet</span>
              <span style={{ fontSize: 13 }}>Go to Acquire and press Space to capture spectra</span>
            </div>
          )}

          {/* Audit trail */}
          {pipeline.length > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 12,
              background: 'var(--paper)', padding: '12px 14px' }}>
              <h5 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>Pipeline audit</h5>
              {pipeline.map((n, i) => (
                <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto',
                  gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)',
                  fontSize: 12, color: 'var(--ink-2)', opacity: n.enabled ? 1 : 0.45 }}>
                  <span className="mono" style={{ color: 'var(--muted)' }}>{i + 1}</span>
                  <span>{n.name} {n.kind === 'sg' && `(w=${n.params.window}, p=${n.params.poly})`}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {n.enabled ? 'on' : 'off'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      context={<NodeInspector />}
    />
  );
}
