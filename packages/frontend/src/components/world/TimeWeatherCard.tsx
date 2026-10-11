import { useTranslation } from 'react-i18next';
import { TIME_PRESETS, WEATHER_KINDS } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';
import { formatWorldTime } from './world-time';

export function TimeWeatherCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  const daylight = state.gamerules.doDaylightCycle;
  const weather = state.gamerules.doWeatherCycle;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.time.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-muted-foreground">{t('world.time.clock')}</span>
          <span className="font-mono text-2xl">{state.time.daytime === null ? t('world.unknown') : formatWorldTime(state.time.daytime)}</span>
          {state.time.day !== null && <span className="text-xs text-muted-foreground">{t('world.time.day', { day: state.time.day })}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((p) => <Button key={p} size="sm" variant="outline" disabled={pending === `time:${p}`} onClick={() => run(`time:${p}`, () => worldApi.setTime(p))}>{t(`world.time.presets.${p}`)}</Button>)}
        </div>
        <div className="flex items-center gap-3">
          <Switch id="freeze-daylight" aria-label={t('world.time.freezeDaylight')} checked={daylight === false} disabled={pending === 'gamerule:doDaylightCycle'} onCheckedChange={(v) => run('gamerule:doDaylightCycle', () => worldApi.setGamerule('doDaylightCycle', !v))} />
          <Label htmlFor="freeze-daylight" className="text-xs">{t('world.time.freezeDaylight')}</Label>
        </div>
        <h3 className="text-sm font-medium">{t('world.weather.title')}</h3>
        <div className="flex flex-wrap gap-2">
          {WEATHER_KINDS.map((k) => <Button key={k} size="sm" variant="outline" disabled={pending === `weather:${k}`} onClick={() => run(`weather:${k}`, () => worldApi.setWeather(k))}>{t(`world.weather.${k}`)}</Button>)}
        </div>
        <div className="flex items-center gap-3">
          <Switch id="freeze-weather" aria-label={t('world.weather.freeze')} checked={weather === false} disabled={pending === 'gamerule:doWeatherCycle'} onCheckedChange={(v) => run('gamerule:doWeatherCycle', () => worldApi.setGamerule('doWeatherCycle', !v))} />
          <Label htmlFor="freeze-weather" className="text-xs">{t('world.weather.freeze')}</Label>
        </div>
      </CardContent>
    </Card>
  );
}
