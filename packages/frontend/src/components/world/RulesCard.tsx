import { useTranslation } from 'react-i18next';
import { DIFFICULTIES, GAMEMODES, type Difficulty, type Gamemode } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WorldCardProps } from './types';

export function RulesCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.rules.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label htmlFor="world-difficulty" className="w-40 shrink-0 text-xs">{t('world.rules.difficulty')}</Label>
            <Select value={state.difficulty ?? undefined} disabled={pending === 'difficulty'} onValueChange={(v) => run('difficulty', () => worldApi.setDifficulty(v as Difficulty))}>
              <SelectTrigger id="world-difficulty" aria-label={t('world.rules.difficulty')} className="h-8 w-48"><SelectValue placeholder={t('world.unknown')} /></SelectTrigger>
              <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {state.resetOnRestart.difficulty && <p className="pl-40 text-xs text-amber-500">{t('world.rules.resetOnRestart', { var: state.resetOnRestart.difficulty })}</p>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label htmlFor="world-gamemode" className="w-40 shrink-0 text-xs">{t('world.rules.gamemode')}</Label>
            <Select value={state.defaultGamemode ?? undefined} disabled={pending === 'gamemode'} onValueChange={(v) => run('gamemode', () => worldApi.setGamemode(v as Gamemode))}>
              <SelectTrigger id="world-gamemode" aria-label={t('world.rules.gamemode')} className="h-8 w-48"><SelectValue placeholder={t('world.unknown')} /></SelectTrigger>
              <SelectContent>{GAMEMODES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {state.resetOnRestart.gamemode && <p className="pl-40 text-xs text-amber-500">{t('world.rules.resetOnRestart', { var: state.resetOnRestart.gamemode })}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
