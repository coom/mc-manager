import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { WorldState } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { TimeWeatherCard } from '@/components/world/TimeWeatherCard';
import { TickCard } from '@/components/world/TickCard';
import { RulesCard } from '@/components/world/RulesCard';
import { GamerulesCard } from '@/components/world/GamerulesCard';

type ApiError = { response?: { data?: { error?: string; code?: string } } };

export default function World() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const online = status === 'ready' || status === 'unhealthy';
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['world'], queryFn: worldApi.get, enabled: isAdmin && online, refetchInterval: 30_000 });
  const [pending, setPending] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ fn }: { key: string; fn: () => Promise<WorldState> }) => fn(),
    onMutate: ({ key }) => setPending(key),
    onSuccess: (state) => { qc.setQueryData(['world'], state); toast.success(t('world.applied')); },
    onError: (e: ApiError) => toast.error(e.response?.data?.code === 'unsupported' ? t('world.unsupported') : e.response?.data?.error ?? t('shared.error')),
    onSettled: () => setPending(null),
  });
  const run = (key: string, fn: () => Promise<WorldState>) => mutation.mutate({ key, fn });
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('world.title')}</h1>
      {!online ? <EmptyState title={t('world.offline')} /> : isLoading || !data ? <PageLoader /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <TimeWeatherCard state={data} pending={pending} run={run} />
          <TickCard state={data} pending={pending} run={run} />
          <RulesCard state={data} pending={pending} run={run} />
          <GamerulesCard state={data} pending={pending} run={run} />
        </div>
      )}
    </div>
  );
}
