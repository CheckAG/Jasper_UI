import { useEffect, useState } from 'react';
import { ipc, type ConfirmRequest } from '../../lib/ipc';
import { Modal } from './Modal';
import { Button } from '../design/Button';

const LABEL: Record<string, string> = { update_firmware: 'install new firmware on the instrument' };

/** Privileged commands asked for by a script, the CLI or an agent wait here
 *  for a person (PRD MHS-07). One at a time; closing the dialog declines. */
export function ConfirmRequests() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  useEffect(() => ipc.onConfirmRequests(
    r => setQueue(q => [...q, r]),
    id => setQueue(q => q.filter(r => r.id !== id)),
  ), []);

  const r = queue[0];
  if (!r) return null;
  const answer = (approve: boolean) => {
    setQueue(q => q.filter(x => x.id !== r.id));
    ipc.answerConfirm(r.id, approve).catch(() => {});   // already timed out: nothing to do
  };
  return (
    <Modal title="Approve this action?" subtitle={`requested by ${r.caller}`} onClose={() => answer(false)}>
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        A {r.caller} outside the app asks to {LABEL[r.command] ?? `run ${r.command}`}. It waits until you answer.
      </span>
      <pre className="mono" style={{ margin: 0, fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(r.args, null, 2)}
      </pre>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={() => answer(false)}>Decline</Button>
        <Button variant="primary" onClick={() => answer(true)}>Approve</Button>
      </div>
    </Modal>
  );
}
