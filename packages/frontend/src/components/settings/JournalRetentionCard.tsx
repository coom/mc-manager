import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { journalApi } from '@/api/journal.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function JournalRetentionCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['journal', 'retention'], queryFn: journalApi.retention });
  const [days, setDays] = useState<number | null>(null);
  const value = days ?? data?.days ?? 90;
  const save = useMutation({
    mutationFn: () => journalApi.setRetention(value),
    onSuccess: () => { toast.success(t('settings.users.journalRetention.saved')); setDays(null); void qc.invalidateQueries({ queryKey: ['journal', 'retention'] }); },
    onError: (err: { response?: { data?: { error?: string } } }) => toast.error(err.response?.data?.error || t('settings.users.journalRetention.failed')),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{t('settings.users.journalRetention.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="journal-retention" className="text-xs w-40">{t('settings.users.journalRetention.days')}</Label>
          <Input id="journal-retention" className="h-8 text-xs w-24" type="number" min={0} max={3650} value={value} onChange={(e) => setDays(Math.max(0, Math.min(3650, parseInt(e.target.value || '0', 10))))} />
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.users.journalRetention.hint')}</p>
        <Button size="sm" disabled={save.isPending || days === null} onClick={() => save.mutate()}>{t('settings.users.journalRetention.save')}</Button>
      </CardContent>
    </Card>
  );
}
