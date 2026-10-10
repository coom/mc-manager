import { useEffect, useMemo, useRef } from 'react';
import type { LogLine } from '@mc/common';
import { cn } from '@/lib/utils';

export type LevelFilter = 'all' | 'warn' | 'error';
const levelClass: Record<LogLine['level'], string> = { INFO: 'text-foreground', WARN: 'text-amber-500', ERROR: 'text-red-500', DEBUG: 'text-muted-foreground', RAW: 'text-muted-foreground' };

export function filterLines(lines: LogLine[], filter: string, level: LevelFilter): LogLine[] {
  const q = filter.trim().toLowerCase();
  return lines.filter((l) => {
    if (level === 'warn' && l.level !== 'WARN' && l.level !== 'ERROR') return false;
    if (level === 'error' && l.level !== 'ERROR') return false;
    return !q || l.raw.toLowerCase().includes(q);
  });
}

export function LogView({ lines, filter, level, paused = false }: { lines: LogLine[]; filter: string; level: LevelFilter; paused?: boolean }) {
  const visible = useMemo(() => filterLines(lines, filter, level), [lines, filter, level]);
  const endRef = useRef<HTMLDivElement>(null);
  const last = visible[visible.length - 1];
  useEffect(() => { if (!paused) endRef.current?.scrollIntoView?.({ block: 'end' }); }, [last, paused]);
  return (
    <div className="h-full overflow-auto rounded-md border bg-black/40 p-3 font-mono text-xs leading-5">
      {visible.map((l, i) => (
        <div key={i} className={cn('whitespace-pre-wrap break-all', levelClass[l.level])}>
          {l.ts && <span className="mr-2 text-muted-foreground">{l.ts}</span>}
          {l.thread && <span className="mr-2 text-muted-foreground/70">[{l.thread}]</span>}
          <span>{l.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
