import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { mapApi } from '@/api/map.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/** Adresse publique de la carte (BlueMap, Dynmap...) affichée dans la page Carte ; vide = page masquée. */
export function MapUrlCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['map'], queryFn: mapApi.get });
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? data?.url ?? '';
  const save = useMutation({
    mutationFn: () => mapApi.set(value.trim()),
    onSuccess: (settings) => { qc.setQueryData(['map'], settings); setDraft(null); toast.success(t('settings.users.mapUrl.saved')); },
    onError: (err: { response?: { data?: { error?: string } } }) => toast.error(err.response?.data?.error || t('settings.users.mapUrl.failed')),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{t('settings.users.mapUrl.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="map-url" className="text-xs w-40">{t('settings.users.mapUrl.url')}</Label>
          <Input id="map-url" className="h-8 text-xs" type="url" placeholder="https://map.example.com/" value={value} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.users.mapUrl.hint')}</p>
        <Button size="sm" disabled={save.isPending || draft === null} onClick={() => save.mutate()}>{t('settings.users.mapUrl.save')}</Button>
      </CardContent>
    </Card>
  );
}
