function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Compact local clock (`HH:mm`), or empty when no time is given. */
export function formatClock(time?: number): string {
  if (time === undefined) return ''
  const d = new Date(time)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
