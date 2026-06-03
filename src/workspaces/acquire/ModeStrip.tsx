import { useAcqStore }     from '../../store/acqStore';
import { useSessionStore } from '../../store/sessionStore';
import { ModeChip }        from '../../components/design/ModeChip';
import { StateChip }       from '../../components/design/StateChip';

export function ModeStrip() {
  const { params, refState, paused, setParam, setRefState, setPaused } = useAcqStore();
  const { captures, selectedIds, clearSelected, toggleSelected } = useSessionStore();

  const allSelected = captures.length > 0 && selectedIds.length === captures.length;

  function toggleAll() {
    if (allSelected || selectedIds.length > 0) {
      clearSelected();
    } else {
      captures.forEach(c => { if (!selectedIds.includes(c.id)) toggleSelected(c.id); });
    }
  }

  const chipBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', border: `1px solid ${active ? 'var(--signal)' : 'var(--line)'}`,
    borderRadius: 8, background: active ? 'var(--signal-soft)' : 'var(--paper)',
    color: active ? 'var(--signal)' : 'var(--ink-2)', cursor: 'pointer',
    fontFamily: 'var(--font-sans)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {(['absorbance', 'reflectance', 'transmittance'] as const).map(m => (
        <ModeChip key={m}
          label={{ absorbance: 'Abs', reflectance: 'Refl', transmittance: 'Trans' }[m]}
          kbd={m[0].toUpperCase()}
          active={params.mode === m}
          onClick={() => setParam('mode', m)}
        />
      ))}

      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />

      {(['dark', 'reference'] as const).map(k => (
        <StateChip key={k}
          status={refState[k]}
          label={k.charAt(0).toUpperCase() + k.slice(1)}
          active={refState.live && k === 'reference'}
          onClick={() => setRefState({ [k]: refState[k] === 'ok' ? 'pending' : 'ok' })}
        />
      ))}

      {/* Stack toggle (PCE_10) — color-coded vertical offset of selected spectra */}
      <button onClick={() => setParam('stack', !params.stack)} style={chipBtn(params.stack)}
        title="Stack selected spectra with vertical offset">
        ▤ Stack
      </button>

      {/* Select-all / clear overlay */}
      {captures.length > 0 && (
        <button onClick={toggleAll} style={chipBtn(false)}
          title="Overlay all / clear">
          {selectedIds.length > 0 ? `Clear (${selectedIds.length})` : 'Overlay all'}
        </button>
      )}

      <button onClick={() => setPaused(!paused)} style={{
        marginLeft: 'auto', padding: '6px 12px', border: '1px solid var(--line)',
        borderRadius: 8, background: paused ? 'var(--signal-soft)' : 'var(--paper)',
        color: paused ? 'var(--signal)' : 'var(--ink-2)',
        cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {paused ? '▶ Resume' : '⏸ Pause'}
        <span className="mono" style={{ fontSize: 10, color: paused ? 'var(--signal)' : 'var(--muted)' }}>P</span>
      </button>
    </div>
  );
}
