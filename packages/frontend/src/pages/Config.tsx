import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ServerPropertiesUpdate } from '@mc/common';
import { configApi } from '@/api/config.api';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { PropertiesForm } from '@/components/config/PropertiesForm';
import { PropertiesRaw } from '@/components/config/PropertiesRaw';
import { RestartBanner } from '@/components/config/RestartBanner';

export default function Config() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: configApi.get, enabled: isAdmin });
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (u: ServerPropertiesUpdate) => configApi.save(u),
    onSuccess: (view) => { qc.setQueryData(['config'], view); setDraft({}); setRaw(null); toast.success(t('config.saved')); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? t('shared.error')),
  });
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  if (isLoading || !data) return <PageLoader />;
  const changedValues = Object.fromEntries(Object.entries(draft).filter(([k, v]) => (data.values[k] ?? '') !== v));
  const rawValue = raw ?? data.raw;
  const dirty = tab === 'form' ? Object.keys(changedValues).length > 0 : rawValue !== data.raw;
  const submit = () => {
    if (!dirty) { toast.error(t('config.noChange')); return; }
    save.mutate(tab === 'form' ? { values: changedValues } : { raw: rawValue });
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('config.title')}</h1>
        {data.exists && <Button className="ml-auto" size="sm" disabled={!dirty || save.isPending} onClick={submit}>{save.isPending ? t('shared.processing') : t('config.save')}</Button>}
      </div>
      {data.restartRequired && <RestartBanner />}
      {!data.exists ? <EmptyState title={t('config.missing')} /> : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'form' | 'raw')}>
          <TabsList><TabsTrigger value="form">{t('config.tabs.form')}</TabsTrigger><TabsTrigger value="raw">{t('config.tabs.raw')}</TabsTrigger></TabsList>
          <Card className="mt-4"><CardContent className="p-4">
            <TabsContent value="form" className="mt-0"><PropertiesForm values={data.values} locked={data.locked} draft={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} /></TabsContent>
            <TabsContent value="raw" className="mt-0"><PropertiesRaw original={data.raw} value={rawValue} onChange={setRaw} /></TabsContent>
          </CardContent></Card>
        </Tabs>
      )}
    </div>
  );
}
