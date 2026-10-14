import { memo, useMemo, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore }      from '../../store/uiStore';
import { ipc }             from '../../lib/ipc';
import type { Capture }    from '../../lib/types';

type Entry =
  | { kind: 'single'; cap: Capture }
  | { kind: 'burst'; key: string; caps: Capture[] };   // oldest shot first

/** Which burst each capture belongs to, if any. Burst shots share an id stem,
 *  burst-<start ms>-<n> (api::burst). Bursts taken before that carry
 *  cap-<ms>-<n> with a different ms per shot: a run of n = 1, 2, 3… is one burst. */
function burstKeys(captures: Capture[]): Map<string, string> {
  const keys = new Map<string, string>();
  let run: { key: string; n: number } | null = null;
  for (const cap of captures) {   // oldest first
    const stem = /^burst-(\d+)-\d+$/.exec(cap.id);
    const old = /^cap-\d+-(\d+)$/.exec(cap.id);
    if (stem) { keys.set(cap.id, stem[1]); run = null; continue; }
    if (!old) { run = null; continue; }
    const n = Number(old[1]);
    run = run && n === run.n + 1 ? { key: run.key, n } : { key: cap.id, n };
    keys.set(cap.id, run.key);
  }
  return keys;
}

/** Newest first; a burst sits where its newest shot would. */
function group(captures: Capture[], keys: Map<string, string>): Entry[] {
  const entries: Entry[] = [];
  const bursts = new Map<string, Capture[]>();
  for (const cap of captures.slice().reverse()) {
    const key = keys.get(cap.id);
    if (!key) { entries.push({ kind: 'single', cap }); continue; }
    if (!bursts.has(key)) { bursts.set(key, []); entries.push({ kind: 'burst', key, caps: bursts.get(key)! }); }
    bursts.get(key)!.unshift(cap);
  }
  return entries;
}

const time = (ms: number, seconds = true) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

/** The capture's shape, small: min-max scaled to the box, 48 points. */
const Spark = memo(function Spark({ ys, color, w = 64, h = 38 }: { ys: ArrayLike<number>; color: string; w?: number; h?: number }) {
  const line = useMemo(() => {
    const n = 48, step = Math.max(1, Math.floor(ys.length / n));
    const pts: number[] = [];
    for (let i = 0; i < ys.length; i += step) pts.push(ys[i]);
    let lo = Infinity, hi = -Infinity;
    for (const v of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    return pts.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1) * w).toFixed(1)} ${(h - 3 - (v - lo) / span * (h - 8)).toFixed(1)}`).join(' ');
  }, [ys, w, h]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
});

function Card({ cap, on, toggle, remove, compact }: {
  cap: Capture; on: boolean; toggle: () => void; remove: () => void; compact?: boolean;
}) {
  return (
    <div onClick={toggle} onContextMenu={e => { e.preventDefault(); remove(); }}
      title="Click to show on the plot · right-click to delete"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '5px 6px' : 8, borderRadius: 10,
        cursor: 'pointer', border: `1px solid ${on ? 'var(--signal)' : 'var(--line)'}`,
        background: on ? 'var(--signal-soft)' : 'var(--paper)' }}>
      <div style={{ flexShrink: 0, borderRadius: 6, background: 'var(--bg)', overflow: 'hidden' }}>
        <Spark ys={cap.ys} color={cap.color} w={compact ? 48 : 64} h={compact ? 28 : 38} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cap.color }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cap.label}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
          <span className="mono">{time(cap.timestamp)}</span>
          {!compact && <><span>·</span><span>{cap.params.mode}</span></>}
        </div>
        {cap.tag && !compact && (
          <span className="mono" style={{ alignSelf: 'flex-start', marginTop: 2, fontSize: 10, padding: '1px 6px',
            borderRadius: 4, background: 'var(--tint)', color: 'var(--ink-2)' }}>{cap.tag}</span>
        )}
      </div>
    </div>
  );
}

function BurstGroup({ caps, open, setOpen, selectedIds, toggle, remove }: {
  caps: Capture[]; open: boolean; setOpen: (v: boolean) => void; selectedIds: string[];
  toggle: (id: string) => void; remove: (c: Capture) => void;
}) {
  const name = caps[0].label.replace(/_\d+$/, '');
  const shown = caps.filter(c => selectedIds.includes(c.id)).length;
  const allOn = shown === caps.length;
  const showAll = () => caps.filter(c => selectedIds.includes(c.id) === allOn).forEach(c => toggle(c.id));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 12,
      border: `1px solid ${shown ? 'var(--signal)' : 'var(--line)'}`, background: 'var(--tint)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 0,
            background: 'transparent', color: 'var(--ink)', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Burst · {name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {caps.length} shots · {time(caps[0].timestamp, false)}–{time(caps[caps.length - 1].timestamp, false)}
              {shown > 0 && !allOn ? ` · ${shown} shown` : ''}
            </span>
          </span>
        </button>
        {!open && (
          <span aria-hidden style={{ display: 'flex', gap: 2 }}>
            {caps.slice(0, 8).map(c => <span key={c.id} style={{ width: 6, height: 6, borderRadius: '50%', background: c.color }} />)}
          </span>
        )}
        <button onClick={showAll} aria-label={`${allOn ? 'Hide' : 'Show'} all shots of ${name}`}
          style={{ height: 26, padding: '0 9px', borderRadius: 7, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', flexShrink: 0,
            border: allOn ? 0 : '1px solid var(--line)', background: allOn ? 'var(--signal)' : 'var(--paper)',
            color: allOn ? 'var(--paper)' : 'var(--ink-2)' }}>
          {allOn ? 'Hide all' : 'Show all'}
        </button>
      </div>
      {open && caps.slice().reverse().map(c => (
        <Card key={c.id} cap={c} compact on={selectedIds.includes(c.id)} toggle={() => toggle(c.id)} remove={() => remove(c)} />
      ))}
    </div>
  );
}

export function CaptureContextPanel() {
  const { captures, selectedIds, removeCapture, toggleSelected, clearSelected } = useSessionStore();
  const setExportOpen = useUIStore(s => s.setExportOpen);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const q = query.trim().toLowerCase();
  const visible = q ? captures.filter(c => c.label.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q)) : captures;
  // Keys from the whole list, so a search cannot split a burst.
  const keys = useMemo(() => burstKeys(captures), [captures]);
  const entries = useMemo(() => group(visible, keys), [visible, keys]);
  const shown = captures.filter(c => selectedIds.includes(c.id)).length;

  async function remove(cap: Capture) {
    if (await ipc.confirm(`Delete capture "${cap.label}"? This removes it from the local database.`)) removeCapture(cap.id);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h5 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Captures</h5>
        <span className="mono" style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999,
          background: 'var(--tint)', color: 'var(--ink-2)' }}>{captures.length}</span>
        <button onClick={() => setExportOpen(true)} disabled={captures.length === 0}
          title={captures.length ? 'Export this workspace\'s captures' : 'No captures to export'}
          style={{ marginLeft: 'auto', height: 28, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8,
            background: 'var(--paper)', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontSize: 12,
            cursor: captures.length ? 'pointer' : 'not-allowed', opacity: captures.length ? 1 : 0.5 }}>
          Export
        </button>
      </div>

      {captures.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Press <kbd className="mono" style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4,
            border: '1px solid var(--line)', background: 'var(--tint)' }}>Space</kbd> to capture
        </span>
      ) : <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px',
          border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="Search captures" placeholder="Search name or tag" value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
              fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink)' }} />
        </label>

        {shown > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px',
            borderRadius: 8, background: 'var(--signal-soft)', color: 'var(--signal)', fontSize: 12 }}>
            <span><b style={{ fontWeight: 600 }}>{shown}</b> on the plot</span>
            <button onClick={clearSelected} style={{ border: 0, background: 'transparent', color: 'var(--signal)',
              fontFamily: 'inherit', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>Clear</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Nothing matches "{query}".</span>}
          {entries.map(e => e.kind === 'single'
            ? <Card key={e.cap.id} cap={e.cap} on={selectedIds.includes(e.cap.id)}
                toggle={() => toggleSelected(e.cap.id)} remove={() => remove(e.cap)} />
            : <BurstGroup key={e.key} caps={e.caps} open={!!open[e.key] || !!q}
                setOpen={v => setOpen(o => ({ ...o, [e.key]: v }))}
                selectedIds={selectedIds} toggle={toggleSelected} remove={remove} />)}
        </div>

        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          Click to show on the plot · right-click to delete
        </span>
      </>}
    </div>
  );
}
