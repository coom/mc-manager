/** daytime 0..23999 → HH:MM ; 0 tick = 06:00, 1000 ticks = une heure. */
export function formatWorldTime(daytime: number): string {
  const totalMinutes = Math.floor((((daytime % 24000) + 24000) % 24000) * 60 / 1000);
  const h = (Math.floor(totalMinutes / 60) + 6) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
