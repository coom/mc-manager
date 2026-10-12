import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GAMERULES, GAMERULE_GROUPS, type GameruleDef } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';

function IntRule({ def, value, pending, run }: { def: GameruleDef; value: number | null } & Pick<WorldCardProps, 'pending' | 'run'>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));
  const n = Number(shown);
  const ok = shown !== '' && Number.isInteger(n) && (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max) && n !== value;
  const key = `gamerule:${def.name}`;
  const label = t(`world.gamerules.names.${def.name}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`gr-${def.name}`} className="w-full text-xs sm:w-56 sm:shrink-0">{label}</Label>
      <Input id={`gr-${def.name}`} type="number" className="h-8 w-24" min={def.min} max={def.max} value={shown} onChange={(e) => setDraft(e.target.value)} />
      {value === null && <span className="text-xs text-muted-foreground">{t('world.unknown')}</span>}
      <Button size="sm" variant="outline" aria-label={`${t('world.gamerules.apply')} ${def.name}`} disabled={!ok || pending === key} onClick={() => run(key, async () => { const s = await worldApi.setGamerule(def.name, n); setDraft(null); return s; })}>{t('world.gamerules.apply')}</Button>
    </div>
  );
}

export function GamerulesCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.gamerules.title')}</CardTitle></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        {state.legacyGamerules && <p className="text-xs text-muted-foreground md:col-span-2">{t('world.gamerules.legacy')}</p>}
        {GAMERULE_GROUPS.map((group) => (
          <section key={group} className="space-y-3">
            <h3 className="text-sm font-medium">{t(`world.gamerules.groups.${group}`)}</h3>
            {GAMERULES.filter((g) => g.group === group).map((def) => {
              const value = state.gamerules[def.name] ?? null;
              if (def.type === 'int') return <IntRule key={def.name} def={def} value={typeof value === 'number' ? value : null} pending={pending} run={run} />;
              const key = `gamerule:${def.name}`; const label = t(`world.gamerules.names.${def.name}`);
              return (
                <div key={def.name} className="flex items-center gap-3">
                  <Switch id={`gr-${def.name}`} aria-label={label} checked={value === true} disabled={pending === key} onCheckedChange={(v) => run(key, () => worldApi.setGamerule(def.name, v))} />
                  <Label htmlFor={`gr-${def.name}`} className="text-xs">{label}</Label>
                  {value === null && <span className="text-xs text-muted-foreground">{t('world.unknown')}</span>}
                </div>
              );
            })}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
