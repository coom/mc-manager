import type { LogLine } from '@mc/common';
const RE = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]*?)\/(INFO|WARN|ERROR|DEBUG|FATAL|TRACE)\]: ?(.*)$/;
export function parseLogLine(rawIn: string): LogLine {
  const raw = rawIn.replace(/\r$/, '');
  const m = RE.exec(raw);
  if (!m) return { ts: null, level: 'RAW', thread: null, message: raw, raw };
  const level = m[3] === 'FATAL' ? 'ERROR' : m[3] === 'TRACE' ? 'DEBUG' : (m[3] as LogLine['level']);
  return { ts: m[1], level, thread: m[2], message: m[4], raw };
}
