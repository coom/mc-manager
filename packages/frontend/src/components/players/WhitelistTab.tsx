import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { errMsg } from './PlayerActionsMenu';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function WhitelistTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const { data } = useQuery({ queryKey: ['lists'], queryFn: playersApi.lists });
  const [name, setName] = useState('');
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [toDeop, setToDeop] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['players'] }); };
  const fail = (e: unknown) => toast.error(errMsg(e, t('shared.error')));
  const toggle = useMutation({ mutationFn: (on: boolean) => playersApi.whitelistEnabled(on), onSuccess: (_d, on) => { toast.success(t(on ? 'players.done.whitelistOn' : 'players.done.whitelistOff')); refresh(); }, onError: fail });
  const add = useMutation({ mutationFn: (n: string) => playersApi.whitelistAdd(n), onSuccess: (_d, n) => { toast.success(t('players.done.whitelistAdd', { name: n })); setName(''); refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: (n: string) => playersApi.whitelistRemove(n), onSuccess: (_d, n) => { toast.success(t('players.done.whitelistRemove', { name: n })); setToRemove(null); refresh(); }, onError: (e) => { fail(e); setToRemove(null); } });
  const deop = useMutation({ mutationFn: (n: string) => playersApi.deop(n), onSuccess: (_d, n) => { toast.success(t('players.done.deop', { name: n })); setToDeop(null); refresh(); }, onError: (e) => { fail(e); setToDeop(null); } });
  if (!data) return null;
  const canAct = isAdmin && ready;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch id="whitelist-enabled" checked={data.whitelistEnabled} disabled={!canAct || toggle.isPending} onCheckedChange={(on) => toggle.mutate(on)} />
          <Label htmlFor="whitelist-enabled">{t('players.whitelist.enabled')}</Label>
        </div>
        {isAdmin && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (NAME_RE.test(name)) add.mutate(name); }}>
            <Input className="h-8 max-w-xs" placeholder={t('players.whitelist.add')} value={name} onChange={(e) => setName(e.target.value)} disabled={!ready} />
            <Button type="submit" size="sm" disabled={!canAct || !NAME_RE.test(name) || add.isPending}>{t('players.whitelist.addButton')}</Button>
          </form>
        )}
        {data.whitelist.length === 0 ? <EmptyState title={t('players.whitelist.empty')} className="py-6" /> : (
          <ul className="divide-y rounded-md border">{data.whitelist.map((w) => (
            <li key={w.uuid} className="flex items-center justify-between px-3 py-2 text-sm"><span>{w.name}</span>
              {isAdmin && <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setToRemove(w.name)}>✕</Button>}</li>
          ))}</ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t('players.whitelist.opsTitle')}</h2>
        {data.ops.length === 0 ? <EmptyState title={t('players.whitelist.opsEmpty')} className="py-6" /> : (
          <ul className="divide-y rounded-md border">{data.ops.map((o) => (
            <li key={o.uuid} className="flex items-center justify-between px-3 py-2 text-sm"><span>{o.name} <span className="text-xs text-muted-foreground">{t('players.whitelist.level')} {o.level}</span></span>
              {isAdmin && <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setToDeop(o.name)}>{t('players.actions.deop')}</Button>}</li>
          ))}</ul>
        )}
      </section>
      <ConfirmDialog open={toRemove !== null} onOpenChange={(o) => !o && setToRemove(null)} title={t('players.confirm.whitelistRemove', { name: toRemove })} description="" loading={remove.isPending} onConfirm={() => toRemove && remove.mutate(toRemove)} />
      <ConfirmDialog open={toDeop !== null} onOpenChange={(o) => !o && setToDeop(null)} title={t('players.confirm.deop', { name: toDeop })} description="" loading={deop.isPending} onConfirm={() => toDeop && deop.mutate(toDeop)} />
    </div>
  );
}
