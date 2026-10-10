import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsRange } from '@mc/common';
import { metricsApi } from '@/api/metrics.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function PlayersChart() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<MetricsRange>('24h');
  const { data } = useQuery({ queryKey: ['metrics', range], queryFn: () => metricsApi.series(range), refetchInterval: 60_000 });
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit' });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{t('dashboard.playersOverTime')}</CardTitle>
        <Tabs value={range} onValueChange={(v) => setRange(v as MetricsRange)}><TabsList>
          <TabsTrigger value="24h">24h</TabsTrigger><TabsTrigger value="7d">7j</TabsTrigger><TabsTrigger value="30d">30j</TabsTrigger>
        </TabsList></Tabs>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data?.points ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="at" tickFormatter={fmt} minTickGap={40} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} width={28} />
            <Tooltip labelFormatter={(v) => fmt(String(v))} formatter={(v: number) => [v.toFixed(1), t('dashboard.players')]} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
            <Area type="monotone" dataKey="players" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.2} isAnimationActive={false} />
            {range !== '24h' && <Area type="step" dataKey="playersMax" stroke="hsl(var(--chart-2))" fill="none" isAnimationActive={false} />}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
