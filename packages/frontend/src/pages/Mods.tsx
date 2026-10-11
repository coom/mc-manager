import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { RestartBanner } from '@/components/shared/RestartBanner';
import { SourceBanner } from '@/components/mods/SourceBanner';
import { ModrinthList } from '@/components/mods/ModrinthList';
import { ManualList } from '@/components/mods/ManualList';
import { describeModsError, type ApiError } from '@/components/mods/mods-errors';

export default function Mods() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mods'], queryFn: modsApi.get });
  const onError = (e: ApiError) => toast.error(describeModsError(e, t));
  const replace = (view: ModsView) => qc.setQueryData(['mods'], view);
  const importMut = useMutation({ mutationFn: modsApi.import, onSuccess: (v) => { replace(v); toast.success(t('mods.imported')); }, onError });
  const add = useMutation({ mutationFn: (entry: string) => modsApi.add(entry), onSuccess: (v) => { replace(v); toast.success(t('mods.added')); }, onError });
  const toggle = useMutation({ mutationFn: ({ entry, enabled }: { entry: string; enabled: boolean }) => modsApi.toggle(entry, enabled), onSuccess: replace, onError });
  const remove = useMutation({ mutationFn: (entry: string) => modsApi.remove(entry), onSuccess: (v) => { replace(v); toast.success(t('mods.removed')); }, onError });
  const toggleFile = useMutation({ mutationFn: ({ file, enabled }: { file: string; enabled: boolean }) => modsApi.toggleFile(file, enabled), onSuccess: replace, onError });
  if (isLoading || !data) return <PageLoader />;
  const pending = importMut.isPending || add.isPending || toggle.isPending || remove.isPending || toggleFile.isPending;
  const canAct = isAdmin && data.server !== null;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('mods.title')}</h1>
      {data.server === null ? (
        <EmptyState title={t('mods.unsupported.title')} description={t('mods.unsupported.description')} />
      ) : (
        <>
          <SourceBanner view={data} canAct={isAdmin} onImport={() => importMut.mutate()} importing={importMut.isPending} />
          {data.restartRequired && <RestartBanner message={t('mods.restartRequired')} />}
          <ModrinthList view={data} canAct={canAct} pending={pending}
            onAdd={(entry, reset) => add.mutate(entry, { onSuccess: reset })}
            onToggle={(entry, enabled) => toggle.mutate({ entry, enabled })}
            onRemove={(entry) => remove.mutate(entry)} />
          <ManualList mods={data.manual} canAct={canAct} pending={pending} onToggle={(file, enabled) => toggleFile.mutate({ file, enabled })} />
        </>
      )}
    </div>
  );
}
