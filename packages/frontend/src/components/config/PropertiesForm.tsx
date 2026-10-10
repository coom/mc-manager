import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Field = { key: string; kind: 'text' | 'number' | 'bool' | 'choice'; min?: number; max?: number; options?: string[] };
export const GROUPS: { id: string; fields: Field[] }[] = [
  { id: 'general', fields: [{ key: 'motd', kind: 'text' }, { key: 'difficulty', kind: 'choice', options: ['peaceful', 'easy', 'normal', 'hard'] }, { key: 'gamemode', kind: 'choice', options: ['survival', 'creative', 'adventure', 'spectator'] }, { key: 'force-gamemode', kind: 'bool' }, { key: 'hardcore', kind: 'bool' }] },
  { id: 'players', fields: [{ key: 'max-players', kind: 'number', min: 1, max: 1000 }, { key: 'white-list', kind: 'bool' }, { key: 'enforce-whitelist', kind: 'bool' }, { key: 'online-mode', kind: 'bool' }, { key: 'player-idle-timeout', kind: 'number', min: 0, max: 1440 }, { key: 'op-permission-level', kind: 'number', min: 1, max: 4 }] },
  { id: 'rules', fields: [{ key: 'pvp', kind: 'bool' }, { key: 'allow-flight', kind: 'bool' }, { key: 'enable-command-block', kind: 'bool' }, { key: 'spawn-protection', kind: 'number', min: 0, max: 100 }, { key: 'spawn-monsters', kind: 'bool' }, { key: 'spawn-animals', kind: 'bool' }, { key: 'spawn-npcs', kind: 'bool' }] },
  { id: 'world', fields: [{ key: 'level-name', kind: 'text' }, { key: 'level-seed', kind: 'text' }, { key: 'level-type', kind: 'choice', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified'] }, { key: 'allow-nether', kind: 'bool' }, { key: 'view-distance', kind: 'number', min: 3, max: 32 }, { key: 'simulation-distance', kind: 'number', min: 3, max: 32 }, { key: 'max-tick-time', kind: 'number', min: -1, max: 600000 }] },
  { id: 'network', fields: [{ key: 'server-port', kind: 'number', min: 1, max: 65535 }, { key: 'resource-pack', kind: 'text' }] },
];

interface Props { values: Record<string, string>; locked: Record<string, string>; draft: Record<string, string>; onChange: (key: string, value: string) => void }

/** Formulaire des clés courantes ; une clé verrouillée est grisée avec la variable qui la gouverne. */
export function PropertiesForm({ values, locked, draft, onChange }: Props) {
  const { t } = useTranslation();
  const current = (k: string) => draft[k] ?? values[k] ?? '';
  const lockTitle = (k: string) => (locked[k] === 'rcon' ? t('config.lockedRcon') : t('config.lockedBy', { var: locked[k] }));
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <section key={g.id} className="space-y-3">
          <h2 className="text-sm font-medium">{t(`config.groups.${g.id}`)}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {g.fields.map((f) => {
              const id = `prop-${f.key}`; const isLocked = f.key in locked; const label = t(`config.fields.${f.key}`);
              return (
                <div key={f.key} className="flex items-center gap-3" title={isLocked ? lockTitle(f.key) : undefined}>
                  <Label htmlFor={id} className="w-44 shrink-0 text-xs">{label}{isLocked && <Lock className="ml-1 inline h-3 w-3 text-muted-foreground" aria-hidden />}</Label>
                  {f.kind === 'bool' && <Switch id={id} aria-label={label} checked={current(f.key) === 'true'} disabled={isLocked} onCheckedChange={(v) => onChange(f.key, v ? 'true' : 'false')} />}
                  {f.kind === 'number' && <Input id={id} type="number" className="h-8 w-32" min={f.min} max={f.max} value={current(f.key)} disabled={isLocked} onChange={(e) => onChange(f.key, e.target.value)} />}
                  {f.kind === 'text' && <Input id={id} className="h-8" value={current(f.key)} disabled={isLocked} onChange={(e) => onChange(f.key, e.target.value)} />}
                  {f.kind === 'choice' && (
                    <Select value={current(f.key) || undefined} disabled={isLocked} onValueChange={(v) => onChange(f.key, v)}>
                      <SelectTrigger id={id} aria-label={label} className="h-8 w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>{f.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
