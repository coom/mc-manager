import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import type { ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { useAuthStore } from '@/stores/auth.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { RestartBanner } from '@/components/shared/RestartBanner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { SourceBanner } from '@/components/mods/SourceBanner';
import { ModrinthList } from '@/components/mods/ModrinthList';
import { ManualList } from '@/components/mods/ManualList';
import { useModUpload } from '@/components/mods/use-mod-upload';
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
  const deleteFile = useMutation({ mutationFn: (file: string) => modsApi.deleteFile(file), onSuccess: replace, onError });
  const upload = useModUpload(replace);
  if (isLoading || !data) return <PageLoader />;
  const pending = importMut.isPending || add.isPending || toggle.isPending || remove.isPending || toggleFile.isPending || deleteFile.isPending || upload.current !== null;
  const canAct = isAdmin && data.server !== null;
  // Conteneur introuvable ou type non supporté : message dédié, listes en lecture seule, pas de bandeau compose ni de redémarrage.
  const issue = data.server === null ? (data.serverIssue ?? 'unsupported') : null;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('mods.title')}</h1>
      {issue ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">{t(`mods.${issue}.title`)}</p>
            <p className="text-muted-foreground">{t(`mods.${issue}.description`)}</p>
          </div>
        </div>
      ) : (
        <>
          <SourceBanner view={data} canAct={isAdmin} onImport={() => importMut.mutate()} importing={importMut.isPending} />
          {data.restartRequired && <RestartBanner message={t('mods.restartRequired')} />}
        </>
      )}
      <ModrinthList view={data} canAct={canAct} pending={pending}
        onAdd={(entry, reset) => add.mutate(entry, { onSuccess: reset })}
        onToggle={(entry, enabled) => toggle.mutate({ entry, enabled })}
        onRemove={(entry) => remove.mutate(entry)} />
      {data.server !== null && (
        <ManualList mods={data.manual} canAct={canAct} pending={pending}
          onToggle={(file, enabled) => toggleFile.mutate({ file, enabled })}
          onDelete={(file) => deleteFile.mutate(file)}
          upload={{ current: upload.current, onFiles: (files) => files.forEach((f) => upload.start(f)), onCancel: upload.cancel }} />
      )}
      <ConfirmDialog open={upload.pendingReplace !== null} onOpenChange={(o) => { if (!o) upload.dismissReplace(); }}
        title={t('mods.upload.replaceTitle', { file: upload.pendingReplace?.name ?? '' })} description={t('mods.upload.replaceDescription')}
        destructive onConfirm={upload.confirmReplace} />
    </div>
  );
}
