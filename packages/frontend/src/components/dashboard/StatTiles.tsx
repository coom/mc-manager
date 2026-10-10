import { useTranslation } from 'react-i18next';
import { Users, Cpu, MemoryStick, Gauge, Globe, HardDrive } from 'lucide-react';
import type { ServerInfo } from '@mc/common';
import { Card, CardContent } from '@/components/ui/card';
import { formatBytes } from '@/lib/utils';
import { formatMspt, formatPercent } from '@/lib/format';

export function StatTiles({ info }: { info: ServerInfo }) {
  const { t } = useTranslation();
  const tiles = [
    { icon: Users, label: t('dashboard.players'), value: info.players ? `${info.players.online} / ${info.players.max}` : '—' },
    { icon: Cpu, label: t('dashboard.cpu'), value: formatPercent(info.stats.cpuPercent) },
    { icon: MemoryStick, label: t('dashboard.memory'), value: info.stats.memUsed != null && info.stats.memLimit != null ? `${formatBytes(info.stats.memUsed)} / ${formatBytes(info.stats.memLimit)}` : '—' },
    { icon: Gauge, label: info.tps != null ? t('dashboard.tps') : t('dashboard.mspt'), value: info.tps != null ? info.tps.toFixed(1) : formatMspt(info.mspt) },
    { icon: Globe, label: t('dashboard.world'), value: info.worldBytes != null ? formatBytes(info.worldBytes) : '—' },
    { icon: HardDrive, label: t('dashboard.diskFree'), value: info.diskFree != null ? formatBytes(info.diskFree) : '—' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Card key={tile.label}><CardContent className="flex items-center gap-3 p-4">
          <tile.icon className="h-5 w-5 text-primary" />
          <div><p className="text-xs text-muted-foreground">{tile.label}</p><p className="font-mono text-lg font-semibold">{tile.value}</p></div>
        </CardContent></Card>
      ))}
    </div>
  );
}
