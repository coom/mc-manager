import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { useServerStore } from '@/stores/server.store';
import { LogView, type LevelFilter } from '@/components/console/LogView';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Console() {
  const { t } = useTranslation();
  const logs = useServerStore((s) => s.logs);
  const connected = useServerStore((s) => s.connected);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(logs);
  const togglePause = () => { if (!paused) setFrozen(logs); setPaused(!paused); };
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{t('console.title')}</h1>
        <span className={connected ? 'text-xs text-emerald-500' : 'text-xs text-red-500'}>{connected ? t('console.live') : t('console.disconnected')}</span>
        <div className="ml-auto flex items-center gap-2">
          <Input className="h-8 w-56" placeholder={t('console.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Select value={level} onValueChange={(v) => setLevel(v as LevelFilter)}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('console.levelAll')}</SelectItem><SelectItem value="warn">{t('console.levelWarn')}</SelectItem><SelectItem value="error">{t('console.levelError')}</SelectItem></SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={togglePause}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1"><LogView lines={paused ? frozen : logs} filter={filter} level={level} paused={paused} /></div>
    </div>
  );
}
