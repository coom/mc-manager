export interface BackupEntry { name: string; size: number; modifiedAt: string }
export interface BackupList { entries: BackupEntry[]; totalBytes: number; running: boolean }
export type RestoreStep = 'check' | 'safety' | 'stop' | 'replace' | 'extract' | 'start';
/** Restauration interrompue (marqueur `.mc-manager-restore.json` trouvé dans les données). */
export interface InterruptedRestore { archive: string; safetyBackup: string | null; startedAt: string }
export interface RestoreStatus { running: boolean; step: RestoreStep | null; interrupted: InterruptedRestore | null }
export interface RestoreRequest { startAfter?: boolean; confirmNoSafetyBackup?: boolean }
export interface RestoreResult { ok: boolean; message: string; safetyBackup: string | null }
