import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TICK_RATE, TICK_SPRINT_MAX } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';

export function TickCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  const [rate, setRate] = useState('');
  const [seconds, setSeconds] = useState('');
  const { supported, targetRate, frozen, sprinting } = state.tick;
  const rateNum = Number(rate);
  const rateOk = rate !== '' && Number.isFinite(rateNum) && rateNum >= TICK_RATE.min && rateNum <= TICK_RATE.max;
  const secNum = Number(seconds);
  const secOk = seconds !== '' && Number.isInteger(secNum) && secNum >= 1 && secNum * 20 <= TICK_SPRINT_MAX;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.tick.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!supported && <p className="text-xs text-muted-foreground">{t('world.tick.unsupported')}</p>}
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-muted-foreground">{t('world.tick.target')}</span>
          <span className="font-mono text-2xl">{targetRate ?? t('world.unknown')}</span>
          {sprinting && <span className="text-xs text-amber-500">{t('world.tick.sprinting')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tick-rate" className="w-32 shrink-0 text-xs">{t('world.tick.rate')}</Label>
          <Input id="tick-rate" type="number" className="h-8 w-28" min={TICK_RATE.min} max={TICK_RATE.max} step="any" value={rate} disabled={!supported} onChange={(e) => setRate(e.target.value)} />
          <Button size="sm" disabled={!supported || !rateOk || pending === 'tick:rate'} onClick={() => run('tick:rate', () => worldApi.setTick({ rate: rateNum }))}>{t('world.tick.apply')}</Button>
          <Button size="sm" variant="outline" disabled={!supported || targetRate === TICK_RATE.default || pending === 'tick:rate'} onClick={() => run('tick:rate', () => worldApi.setTick({ rate: TICK_RATE.default }))}>{t('world.tick.normal')}</Button>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="tick-freeze" aria-label={t('world.tick.freeze')} checked={frozen} disabled={!supported || pending === 'tick:frozen'} onCheckedChange={(v) => run('tick:frozen', () => worldApi.setTick({ frozen: v }))} />
          <Label htmlFor="tick-freeze" className="text-xs">{t('world.tick.freeze')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tick-sprint" className="w-32 shrink-0 text-xs">{t('world.tick.sprintSeconds')}</Label>
          <Input id="tick-sprint" type="number" className="h-8 w-28" min={1} max={TICK_SPRINT_MAX / 20} value={seconds} disabled={!supported} onChange={(e) => setSeconds(e.target.value)} />
          <Button size="sm" disabled={!supported || !secOk || pending === 'tick:sprint'} onClick={() => run('tick:sprint', () => worldApi.setTick({ sprint: secNum * 20 }))}>{t('world.tick.run')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
