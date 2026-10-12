import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock, Skull, Swords, Footprints, ArrowUp, HeartCrack, Pickaxe, Hammer, Crosshair } from 'lucide-react';
import type { VanillaStats } from '@mc/common';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { CountryFlag } from '@/components/players/CountryFlag';
import { PlayerActionsMenu } from '@/components/players/PlayerActionsMenu';
import { formatDuration } from '@/lib/utils';

const hm = (seconds: number) => { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return `${h}h ${m}m`; };
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export default function PlayerSheet() {
  const { uuid = '' } = useParams();
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data, error, isLoading } = useQuery({ queryKey: ['players', 'sheet', uuid], queryFn: () => playersApi.sheet(uuid) });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <EmptyState title={t('players.sheet.notFound')} />;
  const s = data.stats;
  const tiles: { icon: typeof Clock; key: keyof VanillaStats; label: string; fmt: (v: number) => string }[] = [
    { icon: Clock, key: 'playTimeSeconds', label: t('players.sheet.playTime'), fmt: hm },
    { icon: Skull, key: 'deaths', label: t('players.sheet.deaths'), fmt: String },
    { icon: Crosshair, key: 'playerKills', label: t('players.sheet.playerKills'), fmt: String },
    { icon: Swords, key: 'mobKills', label: t('players.sheet.mobKills'), fmt: String },
    { icon: Footprints, key: 'distanceMeters', label: t('players.sheet.distance'), fmt: km },
    { icon: ArrowUp, key: 'jumps', label: t('players.sheet.jumps'), fmt: String },
    { icon: HeartCrack, key: 'damageTaken', label: t('players.sheet.damageTaken'), fmt: String },
    { icon: Pickaxe, key: 'blocksMined', label: t('players.sheet.blocksMined'), fmt: String },
    { icon: Hammer, key: 'itemsCrafted', label: t('players.sheet.itemsCrafted'), fmt: String },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <img src={`https://mc-heads.net/avatar/${encodeURIComponent(data.name)}/48`} alt="" className="h-12 w-12 rounded-md" />
        <div>
          <h1 className="text-xl font-semibold">{data.name}</h1>
          {data.previousNames.length > 0 && <p className="text-xs text-muted-foreground">{t('players.sheet.previousNames')} : {data.previousNames.join(', ')}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {data.online && <Badge variant="success">{t('players.badges.online')}</Badge>}
          {data.op && <Badge>{t('players.badges.op')}</Badge>}
          {data.whitelisted && <Badge variant="secondary">{t('players.badges.whitelisted')}</Badge>}
          {data.banned && <Badge variant="destructive">{t('players.badges.banned')}</Badge>}
        </div>
        {isAdmin && <div className="ml-auto"><PlayerActionsMenu name={data.name} online={data.online} op={data.op} banned={data.banned} hasIp={data.sessions[0]?.ip != null} /></div>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.sheet.playTimeObserved')}</p><p className="font-mono text-lg font-semibold">{hm(data.playTimeObservedSeconds)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.sessions')}</p><p className="font-mono text-lg font-semibold">{data.sessionCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.lastSeen')}</p><p className="font-mono text-lg font-semibold">{data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString(i18n.language) : '—'}</p></CardContent></Card>
      </div>
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {tiles.map((tile) => { const v = s[tile.key]; return (
            <Card key={tile.key}><CardContent className="flex items-center gap-3 p-4"><tile.icon className="h-5 w-5 text-primary" />
              <div><p className="text-xs text-muted-foreground">{tile.label}</p><p className="font-mono text-lg font-semibold">{v == null ? t('players.sheet.unknown') : tile.fmt(v)}</p></div></CardContent></Card>
          ); })}
        </div>
      ) : <p className="text-sm text-muted-foreground">{t('players.sheet.noStats')}</p>}
      <Card>
        <CardHeader><CardTitle className="text-sm">{t('players.sheet.activity')}</CardTitle></CardHeader>
        <CardContent className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tickFormatter={(d) => new Date(String(d)).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })} minTickGap={30} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} width={32} />
              <Tooltip formatter={(v) => [`${v ?? 0} ${t('players.sheet.minutes')}`, '']} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Bar dataKey="minutes" fill="hsl(var(--chart-1))" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">{t('players.sheet.recentSessions')}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.sheet.joined')}</th><th>{t('players.sheet.duration')}</th>{isAdmin && <><th>IP</th><th>{t('players.country')}</th></>}</tr></thead>
            <tbody>{data.sessions.map((se) => (
              <tr key={se.id} className="border-t">
                <td className="py-2">{new Date(se.joinedAt).toLocaleString(i18n.language)}</td>
                <td>{se.leftAt ? formatDuration(Math.max(60, Math.round((new Date(se.leftAt).getTime() - new Date(se.joinedAt).getTime()) / 1000))) : t('players.sheet.stillOnline')}</td>
                {isAdmin && <><td className="font-mono text-xs">{se.ip ?? '—'}</td><td><CountryFlag country={se.country} hasIp={se.ip != null} /></td></>}
              </tr>
            ))}</tbody>
          </table></div>
        </CardContent>
      </Card>
    </div>
  );
}
