export interface BackupEntry { name: string; size: number; modifiedAt: string }
export interface BackupList { entries: BackupEntry[]; totalBytes: number; running: boolean }
export type RestoreStep = 'check' | 'safety' | 'stop' | 'replace' | 'extract' | 'start';
export interface RestoreStatus { running: boolean; step: RestoreStep | null }
export interface RestoreRequest { startAfter?: boolean; confirmNoSafetyBackup?: boolean }
export interface RestoreResult { ok: boolean; message: string; safetyBackup: string | null }
