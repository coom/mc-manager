import type { ServerStatus } from '@mc/common';
export const formatMspt = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} ms`);
export const formatPercent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);
export type Tone = 'ok' | 'warn' | 'error' | 'muted';
export function statusTone(s: ServerStatus): Tone {
  switch (s) { case 'ready': return 'ok'; case 'starting': case 'stopping': return 'warn'; case 'unhealthy': case 'unavailable': return 'error'; default: return 'muted'; }
}
export const toneClass: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
  muted: 'bg-muted text-muted-foreground border-border',
};
