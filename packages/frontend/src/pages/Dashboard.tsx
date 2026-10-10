import { useQuery } from '@tanstack/react-query';
import { serverApi } from '@/api/server.api';
import { useServerStore } from '@/stores/server.store';
import { StatusBanner } from '@/components/dashboard/StatusBanner';
import { StatTiles } from '@/components/dashboard/StatTiles';
import { PlayersCard } from '@/components/dashboard/PlayersCard';
import { PlayersChart } from '@/components/dashboard/PlayersChart';

export default function Dashboard() {
  const pushed = useServerStore((s) => s.info);
  const { data: fetched } = useQuery({ queryKey: ['server'], queryFn: serverApi.get, enabled: !pushed });
  const info = pushed ?? fetched;
  return (
    <div className="space-y-5">
      <StatusBanner />
      {info && <StatTiles info={info} />}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><PlayersChart /></div>
        <PlayersCard names={info?.players?.names ?? []} />
      </div>
    </div>
  );
}
