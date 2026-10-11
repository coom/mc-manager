import type { WorldState } from '@mc/common';
/** Props communes aux cartes : état courant, clé du contrôle en cours, et déclencheur d'action. */
export interface WorldCardProps { state: WorldState; pending: string | null; run: (key: string, fn: () => Promise<WorldState>) => void }
