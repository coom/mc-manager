import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import {
  BACKUP_INTERVAL_MAX_MINUTES, BACKUP_INTERVAL_MIN_MINUTES, BACKUP_INTERVAL_UNITS, BACKUP_SETTINGS_COMPOSE_SNIPPET, PRUNE_DAYS_MAX, PRUNE_DAYS_MIN,
  type BackupIntervalUnit, type BackupSettingValue, type BackupSettingsUpdate,
} from '@mc/common';
import { backupsApi } from '@/api/backups.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { ApiError } from '@/components/mods/mods-errors';
import { describeBackupSettingsError } from './backup-settings-errors';
import { UNIT_MINUTES, splitInterval } from './interval';

const QUERY_KEY = ['backups', 'settings'];

function everyText(value: string, t: TFunction): string {
  const s = splitInterval(value);
  return s ? t(`backups.schedule.every.${s.unit}`, { count: s.amount }) : t('backups.schedule.everyRaw', { value });
}

function daysText(value: string, t: TFunction): string {
  return /^\d+$/.test(value) ? t('backups.schedule.days', { count: Number(value) }) : value;
}

function SourceHint({ v }: { v: BackupSettingValue }) {
  const { t } = useTranslation();
  if (v.source === 'file') return null;
  return <span className="ml-1 text-xs text-muted-foreground">({t(`backups.schedule.source.${v.source}`)})</span>;
}

/** Intervalle et rétention de mc-backup : lecture pour tous, modification par un admin quand le compose lit le fichier. */
export function BackupScheduleCard({ isAdmin, busy }: { isAdmin: boolean; busy: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: QUERY_KEY, queryFn: backupsApi.settings });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<BackupIntervalUnit>('h');
  const [days, setDays] = useState('');
  const [toApply, setToApply] = useState<BackupSettingsUpdate | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: (body: BackupSettingsUpdate) => backupsApi.updateSettings(body),
    onSuccess: (s) => { qc.setQueryData(QUERY_KEY, s); setEditing(false); toast.success(t('backups.schedule.applied')); },
    onError: (e) => { toast.error(describeBackupSettingsError(e as ApiError, t)); void qc.invalidateQueries({ queryKey: QUERY_KEY }); },
    onSettled: () => setToApply(null),
  });

  if (!data) return null;
  const header = <CardHeader className="pb-3"><CardTitle className="text-base">{t('backups.schedule.title')}</CardTitle></CardHeader>;
  const { interval, pruneDays } = data;
  if (!data.containerFound || !interval || !pruneDays) {
    return <Card>{header}<CardContent><p className="text-sm text-muted-foreground">{t('backups.schedule.noContainer')}</p></CardContent></Card>;
  }

  const canEdit = isAdmin && data.managed && data.cronSchedule === null;
  const amountNum = Number(amount);
  const minutes = amount !== '' && Number.isInteger(amountNum) && amountNum > 0 ? amountNum * UNIT_MINUTES[unit] : null;
  const intervalOk = minutes !== null && minutes >= BACKUP_INTERVAL_MIN_MINUTES && minutes <= BACKUP_INTERVAL_MAX_MINUTES;
  const daysNum = Number(days);
  const daysOk = days !== '' && Number.isInteger(daysNum) && daysNum >= PRUNE_DAYS_MIN && daysNum <= PRUNE_DAYS_MAX;
  const next: BackupSettingsUpdate = { interval: `${amountNum}${unit}`, pruneDays: daysNum };
  const unchanged = !data.pendingRestart && interval.source === 'file' && interval.value === next.interval
    && pruneDays.source === 'file' && pruneDays.value === String(next.pruneDays);

  const startEdit = () => {
    const s = splitInterval(interval.value);
    setAmount(s ? String(s.amount) : '');
    setUnit(s?.unit ?? 'h');
    setDays(/^\d+$/.test(pruneDays.value) ? pruneDays.value : '');
    setEditing(true);
  };
  const copy = () => { void navigator.clipboard?.writeText(BACKUP_SETTINGS_COMPOSE_SNIPPET).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  return (
    <Card>
      {header}
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t('backups.schedule.interval')}</dt>
          <dd>{data.cronSchedule !== null ? t('backups.schedule.cron', { schedule: data.cronSchedule }) : <>{everyText(interval.value, t)}<SourceHint v={interval} /></>}</dd>
          <dt className="text-muted-foreground">{t('backups.schedule.retention')}</dt>
          <dd>{daysText(pruneDays.value, t)}<SourceHint v={pruneDays} /></dd>
        </dl>
        {!data.running && <p className="text-xs text-amber-500">{t('backups.schedule.stopped')}</p>}
        {data.pendingRestart && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="flex-1">{t('backups.schedule.pending')}</span>
            {canEdit && <Button size="sm" variant="outline" disabled={busy || save.isPending} onClick={() => save.mutate({ interval: interval.value, pruneDays: Number(pruneDays.value) })}>{t('backups.schedule.retry')}</Button>}
          </div>
        )}
        {isAdmin && !data.managed && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="font-medium">{t('backups.schedule.notManaged.title')}</p>
            <p className="text-muted-foreground">{t('backups.schedule.notManaged.description')}</p>
            <p className="text-xs text-muted-foreground">{t('backups.schedule.notManaged.snippet')}</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono-data text-xs">{BACKUP_SETTINGS_COMPOSE_SNIPPET}</pre>
              <Button size="sm" variant="outline" onClick={copy} aria-label={t('backups.schedule.notManaged.copy')}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>
        )}
        {canEdit && !editing && <Button size="sm" variant="outline" disabled={busy} onClick={startEdit}>{t('backups.schedule.edit')}</Button>}
        {canEdit && editing && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="backup-interval" className="w-full text-xs sm:w-32 sm:shrink-0">{t('backups.schedule.interval')}</Label>
              <Input id="backup-interval" type="number" min={1} className="h-8 w-full sm:w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Select value={unit} onValueChange={(v) => setUnit(v as BackupIntervalUnit)}>
                <SelectTrigger aria-label={t('backups.schedule.unit')} className="h-8 w-full sm:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{BACKUP_INTERVAL_UNITS.map((u) => <SelectItem key={u} value={u}>{t(`backups.schedule.units.${u}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {amount !== '' && !intervalOk && <p className="text-xs text-destructive">{t('backups.schedule.intervalRange', { min: BACKUP_INTERVAL_MIN_MINUTES, max: BACKUP_INTERVAL_MAX_MINUTES / 1440 })}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="backup-retention" className="w-full text-xs sm:w-32 sm:shrink-0">{t('backups.schedule.retention')}</Label>
              <Input id="backup-retention" type="number" min={PRUNE_DAYS_MIN} max={PRUNE_DAYS_MAX} className="h-8 w-full sm:w-24" value={days} onChange={(e) => setDays(e.target.value)} />
              <span className="text-xs text-muted-foreground">{t('backups.schedule.daysUnit')}</span>
            </div>
            {days !== '' && !daysOk && <p className="text-xs text-destructive">{t('backups.schedule.daysRange', { min: PRUNE_DAYS_MIN, max: PRUNE_DAYS_MAX })}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!intervalOk || !daysOk || unchanged || busy || save.isPending} onClick={() => setToApply(next)}>{t('backups.schedule.apply')}</Button>
              <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setEditing(false)}>{t('shared.cancel')}</Button>
            </div>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={toApply !== null}
        onOpenChange={(o) => { if (!o && !save.isPending) setToApply(null); }}
        title={t('backups.schedule.confirm.title')}
        description={toApply ? t(data.backupOnStartup ? 'backups.schedule.confirm.description' : 'backups.schedule.confirm.descriptionNoStartup', {
          delay: data.initialDelay, every: everyText(toApply.interval, t), days: daysText(String(toApply.pruneDays), t),
        }) : ''}
        confirmLabel={t('backups.schedule.apply')}
        loading={save.isPending}
        onConfirm={() => { if (toApply && !save.isPending) save.mutate(toApply); }}
      />
    </Card>
  );
}
