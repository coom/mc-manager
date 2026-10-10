import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { serverApi } from '@/api/server.api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export function RestartBanner() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const restart = useMutation({ mutationFn: () => serverApi.restart(), onSuccess: () => {
    toast.success(t('config.restarting')); setOpen(false);
    void qc.invalidateQueries({ queryKey: ['config'] }); void qc.invalidateQueries({ queryKey: ['server'] });
  }, onError: (e: { response?: { data?: { error?: string } } }) => { toast.error(e.response?.data?.error ?? t('shared.error')); setOpen(false); } });
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <RefreshCw className="h-4 w-4 text-amber-500" />
      <span>{t('config.restartRequired')}</span>
      <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>{t('config.restartNow')}</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t('config.restartTitle')} description={t('config.restartDescription')} destructive loading={restart.isPending} onConfirm={() => restart.mutate()} />
    </div>
  );
}
