export type AuditAction =
  | 'server.start' | 'server.stop' | 'server.restart' | 'rcon.command'
  | 'backup.run' | 'backup.delete' | 'backup.download'
  | 'user.create' | 'user.update' | 'user.delete';
export interface AuditEntry { id: number; at: string; userId: number; username: string; action: AuditAction; detail: string | null; ip: string | null }
export interface AuditPage { entries: AuditEntry[]; total: number; page: number; pageSize: number }
