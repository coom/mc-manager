export type AuditAction =
  | 'server.start' | 'server.stop' | 'server.restart' | 'rcon.command'
  | 'backup.run' | 'backup.delete' | 'backup.download' | 'backup.settings'
  | 'user.create' | 'user.update' | 'user.delete'
  | 'player.kick' | 'player.ban' | 'player.ban_ip' | 'player.pardon' | 'player.pardon_ip' | 'player.op' | 'player.deop'
  | 'whitelist.add' | 'whitelist.remove' | 'whitelist.toggle'
  | 'backup.restore' | 'server.properties'
  | 'journal.retention'
  | 'mods.import' | 'mods.add' | 'mods.toggle' | 'mods.remove' | 'mods.file.toggle'
  | 'mods.upload' | 'mods.file.delete'
  | 'world.time' | 'world.weather' | 'world.difficulty' | 'world.gamemode' | 'world.tick' | 'world.gamerule'
  | 'map.url';
export interface AuditEntry { id: number; at: string; userId: number; username: string; action: AuditAction; detail: string | null; ip: string | null }
export interface AuditPage { entries: AuditEntry[]; total: number; page: number; pageSize: number }
