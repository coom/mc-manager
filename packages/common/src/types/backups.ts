export interface BackupEntry { name: string; size: number; modifiedAt: string }
export interface BackupList { entries: BackupEntry[]; totalBytes: number; running: boolean }
