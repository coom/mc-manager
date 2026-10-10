import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auditApi } from '@/api/audit.api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ACTIONS = ['', 'server', 'rcon', 'backup', 'user'];

export default function Audit() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const pageSize = 50;
  const { data } = useQuery({ queryKey: ['audit', page, action, user], queryFn: () => auditApi.list({ page, pageSize, action: action || undefined, user: user || undefined }) });
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
        <div className="ml-auto flex gap-2">
          <Select value={action || 'all'} onValueChange={(v) => { setAction(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIONS.map((a) => <SelectItem key={a || 'all'} value={a || 'all'}>{t(`audit.actions.${a || 'all'}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-8 w-40" placeholder={t('audit.user')} value={user} onChange={(e) => { setUser(e.target.value); setPage(1); }} />
        </div>
      </div>
      <Card><CardContent className="p-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('audit.when')}</th><th>{t('audit.who')}</th><th>{t('audit.action')}</th><th>{t('audit.detail')}</th><th>IP</th></tr></thead>
          <tbody>{(data?.entries ?? []).map((e) => (
            <tr key={e.id} className="border-t"><td className="py-2">{new Date(e.at).toLocaleString(i18n.language)}</td><td>{e.username}</td><td className="font-mono text-xs">{e.action}</td><td className="font-mono text-xs">{e.detail}</td><td className="text-xs text-muted-foreground">{e.ip}</td></tr>
          ))}</tbody>
        </table>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
          <span>{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
