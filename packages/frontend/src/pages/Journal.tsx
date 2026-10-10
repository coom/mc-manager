import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { journalApi, type JournalQuery } from '@/api/journal.api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { CountryFlag } from '@/components/players/CountryFlag';
import { formatDuration } from '@/lib/utils';

type Tab = 'players' | 'failures' | 'web';
const LIMIT = 50;

export default function Journal() {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [tab, setTab] = useState<Tab>('players');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const params: JournalQuery = { q: q || undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, page, limit: LIMIT };
  const players = useQuery({ queryKey: ['journal', 'players', params], queryFn: () => journalApi.players(params), enabled: isAdmin && tab === 'players' });
  const failures = useQuery({ queryKey: ['journal', 'failures', params], queryFn: () => journalApi.failures(params), enabled: isAdmin && tab === 'failures' });
  const web = useQuery({ queryKey: ['journal', 'web', params], queryFn: () => journalApi.web(params), enabled: isAdmin && tab === 'web' });
  const total = (tab === 'players' ? players.data : tab === 'failures' ? failures.data : web.data)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const duration = (joined: string, left: string | null) => (left ? formatDuration(Math.max(60, Math.round((new Date(left).getTime() - new Date(joined).getTime()) / 1000))) : t('journal.ongoing'));
  const reset = () => setPage(1);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const empty = <EmptyState title={t('journal.empty')} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t('journal.title')}</h1>
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); reset(); }} className="ml-4"><TabsList>
          <TabsTrigger value="players">{t('journal.tabs.players')}</TabsTrigger><TabsTrigger value="failures">{t('journal.tabs.failures')}</TabsTrigger><TabsTrigger value="web">{t('journal.tabs.web')}</TabsTrigger>
        </TabsList></Tabs>
        <div className="ml-auto flex flex-wrap gap-2">
          <Input className="h-8 w-36" placeholder={t('journal.filterName')} value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <Input className="h-8 w-36" type="date" aria-label={t('journal.from')} value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          <Input className="h-8 w-36" type="date" aria-label={t('journal.to')} value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        </div>
      </div>
      <Card><CardContent className="p-4">
        {tab === 'players' && (players.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.duration')}</th></tr></thead>
            <tbody>{(players.data?.items ?? []).map((s) => (
              <tr key={s.id} className="border-t"><td className="py-2">{fmt(s.joinedAt)}</td><td>{s.name}</td><td className="font-mono text-xs">{s.ip ?? <span className="text-muted-foreground">{t('journal.reconciled')}</span>}</td><td><CountryFlag country={s.country} hasIp={s.ip != null} /></td><td>{duration(s.joinedAt, s.leftAt)}</td></tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'failures' && (failures.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.reason')}</th></tr></thead>
            <tbody>{(failures.data?.items ?? []).map((f) => (
              <tr key={f.id} className="border-t"><td className="py-2">{fmt(f.createdAt)}</td><td>{f.name}</td><td className="font-mono text-xs">{f.ip ?? '—'}</td><td><CountryFlag country={f.country} hasIp={f.ip != null} /></td><td><Badge variant="warning">{t(`journal.reasons.${f.reason}`)}</Badge> <span className="text-xs text-muted-foreground">{f.message}</span></td></tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'web' && (web.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.result')}</th></tr></thead>
            <tbody>{(web.data?.items ?? []).map((w) => (
              <tr key={w.id} className="border-t"><td className="py-2">{fmt(w.createdAt)}</td><td>{w.username}</td><td className="font-mono text-xs">{w.ip}</td><td><CountryFlag country={w.country} hasIp /></td>
                <td><Badge variant={w.success ? 'success' : 'destructive'}>{t(w.success ? 'journal.success' : 'journal.failure')}</Badge> {w.reason && <span className="text-xs text-muted-foreground">{t(`journal.reasons.${w.reason}`)}</span>}</td></tr>
            ))}</tbody>
          </table>
        ))}
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
          <span>{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
