import { useEffect } from 'react';
import { useChemStore }  from '../../store/chemStore';
import { useSessionStore}from '../../store/sessionStore';
import { WorkspaceShell }from '../../components/layout/WorkspaceShell';
import { Button }        from '../../components/design/Button';
import { StaticChart }   from '../../spectrum/StaticChart';

// ── Shared tab header ──────────────────────────────────────────
const TABS = ['explore', 'classify', 'regress', 'predict', 'mixture'] as const;

function TabBar() {
  const { activeTab, setTab } = useChemStore();
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {TABS.map(t => (
        <button key={t} onClick={() => setTab(t)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 9,
          background: activeTab === t ? 'var(--ink)' : 'var(--paper)',
          color: activeTab === t ? 'var(--paper)' : 'var(--ink-2)',
          cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13,
          textTransform: 'capitalize',
        }}>{t}</button>
      ))}
    </div>
  );
}

// ── Explore (PCA) ────────────────────────────────────────────
function ExploreTab() {
  const { pcaResult, isRunning, nComponents, setComponents, runPCA } = useChemStore();
  const { captures } = useSessionStore();

  function handleRun() {
    const spectra = captures.map(c => c.ys);
    const labels = captures.map(c => c.tag || c.label);
    runPCA(spectra, labels);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Components</span>
        <input type="range" min={2} max={10} value={nComponents}
          onChange={e => setComponents(Number(e.target.value))}
          style={{ width: 120, accentColor: 'var(--signal)' }} />
        <span className="mono" style={{ fontSize: 13 }}>{nComponents}</span>
        <Button size="sm" variant="primary" onClick={handleRun} disabled={isRunning || captures.length < 2}>
          {isRunning ? 'Running…' : 'Run PCA'}
        </Button>
      </div>

      {pcaResult ? (
        <>
          {/* Variance explained */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pcaResult.explainedVariance.slice(0, nComponents).map((v, i) => (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8,
                padding: '6px 12px', background: 'var(--paper)' }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>PC{i + 1}</span>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>
                  {(v * 100).toFixed(0)}<small style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 2 }}>%</small>
                </div>
              </div>
            ))}
          </div>

          {/* Scatter plot canvas */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 14,
            background: 'var(--paper)', padding: 16, minHeight: 260, position: 'relative' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>PC1 × PC2 score plot</span>
            <ScatterPlot scores={pcaResult.scores} labels={pcaResult.labels} />
          </div>
        </>
      ) : (
        <EmptyState message={captures.length < 2 ? 'Need ≥ 2 captures to run PCA' : 'Click Run PCA to explore'} />
      )}
    </div>
  );
}

// ── Regress ───────────────────────────────────────────────────
function RegressTab() {
  const { regressionResult, isRunning, isTraining, nComponents, setComponents, trainModel } = useChemStore();
  const { captures } = useSessionStore();

  function handleTrain() {
    const spectra = captures.map(c => c.ys);
    const targets = captures.map((_, i) => 10 + i * 2 + Math.random());
    trainModel('pls', captures.map(c => c.id), spectra, targets);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Latent variables</span>
        <input type="range" min={1} max={10} value={nComponents}
          onChange={e => setComponents(Number(e.target.value))}
          style={{ width: 120, accentColor: 'var(--signal)' }} />
        <span className="mono" style={{ fontSize: 13 }}>{nComponents}</span>
        <Button size="sm" variant="primary" onClick={handleTrain} disabled={isTraining || captures.length < 3}>
          {isTraining ? 'Training…' : 'Train PLS'}
        </Button>
      </div>

      {regressionResult ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['RMSEP', regressionResult.rmsep.toFixed(3)],
              ['R²',    regressionResult.r2.toFixed(3)],
              ['Bias',  regressionResult.bias.toFixed(3)],
              ['N',     String(regressionResult.predicted.length)],
            ].map(([k, v]) => (
              <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 8,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '0.1em' }}>{k}</span>
                <span style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12,
            background: 'var(--paper)', padding: 12, minHeight: 200, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>
            Predicted vs actual scatter (Phase C: real data)
          </div>
        </>
      ) : (
        <EmptyState message={captures.length < 3 ? 'Need ≥ 3 captures to train' : 'Click Train PLS to fit model'} />
      )}
    </div>
  );
}

// ── Predict ──────────────────────────────────────────────────
function PredictTab() {
  const { predictionResult, isRunning, models, activeModelId, setActiveModel, predict } = useChemStore();
  const { captures } = useSessionStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Model</span>
        <select value={activeModelId ?? ''} onChange={e => setActiveModel(e.target.value || null)}
          style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8,
            background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-mono)',
            fontSize: 12, cursor: 'pointer' }}>
          <option value="">— select —</option>
          {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <Button size="sm" variant="primary"
          disabled={!activeModelId || !captures.length || isRunning}
          onClick={() => activeModelId && captures.length && predict(captures[captures.length - 1].ys, activeModelId)}>
          {isRunning ? 'Predicting…' : 'Predict latest'}
        </Button>
      </div>

      {predictionResult ? (
        <div style={{ border: '1px solid var(--line)', borderRadius: 14,
          background: 'var(--paper)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em' }}>Result</span>
            <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>
              {predictionResult.value.toFixed(1)}
              <small style={{ fontSize: 18, color: 'var(--muted)', marginLeft: 4 }}>{predictionResult.unit}</small>
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              95% CI: {predictionResult.ci95[0].toFixed(1)} – {predictionResult.ci95[1].toFixed(1)} {predictionResult.unit}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>
              Top contributing bands
            </span>
            {predictionResult.topBands.map(b => (
              <div key={b.nm} style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-2)' }}>
                  <span className="mono">{b.nm} nm</span>
                  <span>{(b.contribution * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--tint-2)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${b.contribution * 100}%`,
                    background: 'var(--signal)', borderRadius: 99 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState message="Select a model and click Predict latest" />
      )}
    </div>
  );
}

// ── Mixture ──────────────────────────────────────────────────
function MixtureTab() {
  const { mixtureResult, isRunning, analyzeMixture } = useChemStore();
  const { captures } = useSessionStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Button size="sm" variant="primary"
        disabled={!captures.length || isRunning}
        onClick={() => captures.length && analyzeMixture(captures[captures.length - 1].ys, ['c1', 'c2', 'c3', 'c4'])}>
        {isRunning ? 'Analysing…' : 'Analyse mixture'}
      </Button>

      {mixtureResult ? (
        <>
          {/* Stacked bar */}
          <div style={{ height: 44, borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
            {mixtureResult.components.map(c => (
              <div key={c.id} style={{ flex: c.fraction, background: c.color }} title={c.name} />
            ))}
            <div style={{ flex: mixtureResult.residual, background: 'var(--line-2)' }} title="Residual" />
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mixtureResult.components.map(c => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto',
                gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--ink-2)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: c.color }} />
                <span>{c.name}</span>
                <span className="mono" style={{ fontSize: 13 }}>{(c.fraction * 100).toFixed(1)}%</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto',
              gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--muted)' }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--line-2)' }} />
              <span>Residual</span>
              <span className="mono" style={{ fontSize: 13 }}>{(mixtureResult.residual * 100).toFixed(1)}%</span>
            </div>
          </div>
        </>
      ) : (
        <EmptyState message={!captures.length ? 'Capture a spectrum first' : 'Click Analyse mixture'} />
      )}
    </div>
  );
}

// ── Classify placeholder ─────────────────────────────────────
function ClassifyTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper)',
        padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Confusion matrix</span>
        {/* Placeholder matrix */}
        <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ color: 'var(--muted)', fontWeight: 400, padding: '4px 8px' }}></th>
              {['Maize', 'Wheat', 'Soil'].map(c => (
                <th key={c} style={{ color: 'var(--muted)', fontWeight: 400, textAlign: 'right', padding: '4px 8px' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[['Maize', 12, 0, 0], ['Wheat', 0, 9, 1], ['Soil', 0, 1, 8]].map(([label, ...vals]) => (
              <tr key={String(label)}>
                <td style={{ color: 'var(--muted)', padding: '4px 8px' }}>{label}</td>
                {vals.map((v, i) => (
                  <td key={i} style={{
                    width: 34, height: 30, textAlign: 'center', padding: '4px 8px',
                    border: '1px solid var(--line)',
                    background: i === vals.indexOf(Math.max(...vals as number[])) ? 'rgba(31,157,85,0.18)' : 'var(--signal-soft)',
                    color: i === vals.indexOf(Math.max(...vals as number[])) ? 'var(--accent-ok)' : 'var(--ink)',
                    fontWeight: i === vals.indexOf(Math.max(...vals as number[])) ? 600 : 400,
                  }}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Scatter canvas ────────────────────────────────────────────
function ScatterPlot({ scores, labels }: { scores: number[][]; labels: string[] }) {
  const COLORS = ['#1f5dff','#06b6c4','#6b4ee0','#d97706','#1f9d55','#c0322d'];
  const uniqueLabels = [...new Set(labels)];

  const xs = scores.map(s => s[0]);
  const ys = scores.map(s => s[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const W = 460, H = 220, PAD = 20;

  const px = (v: number) => PAD + (v - xMin) / (xMax - xMin + 0.001) * (W - PAD * 2);
  const py = (v: number) => PAD + (1 - (v - yMin) / (yMax - yMin + 0.001)) * (H - PAD * 2);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 8 }}>
      {scores.map((s, i) => (
        <circle key={i} cx={px(s[0])} cy={py(s[1])} r={5}
          fill={COLORS[uniqueLabels.indexOf(labels[i]) % COLORS.length]}
          opacity={0.85}>
          <title>{labels[i]}</title>
        </circle>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="#7a808a">PC1</text>
      <text x={10} y={H / 2} textAnchor="middle" fontSize={10} fill="#7a808a"
        transform={`rotate(-90, 10, ${H / 2})`}>PC2</text>
    </svg>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 8, color: 'var(--muted)', padding: 40 }}>
      <div style={{ width: 40, height: 40, border: '2px dashed var(--line-2)', borderRadius: 10 }} />
      <span style={{ fontSize: 13 }}>{message}</span>
    </div>
  );
}

function ModelShelf() {
  const { models, activeModelId, setActiveModel, loadModels } = useChemStore();
  useEffect(() => { loadModels(); }, [loadModels]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h5 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Models ({models.length})</h5>
      {models.map(m => (
        <button key={m.id} onClick={() => setActiveModel(m.id === activeModelId ? null : m.id)}
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px',
            border: `1px solid ${activeModelId === m.id ? 'var(--signal)' : 'var(--line)'}`,
            borderRadius: 10, background: 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>v{m.version}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(m.metrics).map(([k, v]) => (
              <span key={k} className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {k.toUpperCase()} {typeof v === 'number' ? v.toFixed(2) : v}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

export function ChemometricsWorkspace() {
  const { activeTab } = useChemStore();

  const TAB_CONTENT = {
    explore:  <ExploreTab />,
    classify: <ClassifyTab />,
    regress:  <RegressTab />,
    predict:  <PredictTab />,
    mixture:  <MixtureTab />,
  };

  return (
    <WorkspaceShell
      canvas={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>Chemometrics</div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Models & Analysis
            </h2>
          </div>
          <TabBar />
          {TAB_CONTENT[activeTab]}
        </div>
      }
      context={<ModelShelf />}
    />
  );
}
