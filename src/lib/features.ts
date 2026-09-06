import type { WorkspaceId } from './types';

/** Every workspace the app can render, in rail order. */
export const ALL_WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: 'instrument',   label: 'Instrument' },
  { id: 'acquire',      label: 'Acquire' },
  { id: 'analyze',      label: 'Analyze' },
  { id: 'chemometrics', label: 'Chemometrics' },
];

/**
 * Which of them are switched on.
 *
 * Phase E narrows the product to the two workspaces that talk to hardware.
 * Analyze and Chemometrics are hidden, not deleted — their code, stores and the
 * Python sidecar behind them are untouched, so bringing them back is adding two
 * entries to this array and nothing else.
 *
 * `store/analyzeStore.ts` stays regardless: the Export dialog reads the pipeline
 * from it, so it is live even with the Analyze workspace hidden.
 */
export const ENABLED_WORKSPACES: WorkspaceId[] = ['instrument', 'acquire'];

export const isWorkspaceEnabled = (id: WorkspaceId): boolean =>
  ENABLED_WORKSPACES.includes(id);

/** The rail and the command palette both render exactly this. */
export const WORKSPACES = ALL_WORKSPACES.filter(w => isWorkspaceEnabled(w.id));

/** Where to land when the stored workspace is one that is switched off. */
export const DEFAULT_WORKSPACE: WorkspaceId = WORKSPACES[0]?.id ?? 'acquire';
