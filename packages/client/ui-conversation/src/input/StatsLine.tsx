import { memo } from 'react'
import type { SessionStats } from '@abyss-harness/client-connection'
import css from './StatsLine.module.css'

/** Compact token count: 517 / 12.2K / 1.2M (one decimal under three digits). */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Cache-hit share of prompt-side input, as an integer percent; null when
 *  the provider reported no cache traffic. */
function cacheHitPercent(usage: SessionStats['usage']): string | null {
  if (!usage.cacheReadTokens) return null
  return String(Math.min(100, Math.round(usage.cacheReadTokens / usage.inputTokens * 100)))
}

/** The composer dock's stats strip, mirroring dsh's StatsLine: pipe-separated
 *  groups (counts · durations · speeds · billing) folded server-side from the
 *  durable log, so paging and restarts cannot change them. A group with no
 *  data drops out whole; with no data at all the line does not render. */
export const StatsLine = memo(function StatsLine({ stats }: { stats?: SessionStats | null }) {
  if (!stats || stats.steps === 0) return null

  const groups: string[] = []
  groups.push(`${stats.turns} 轮 / ${stats.steps} 步`)

  const durations: string[] = []
  if (stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`)
  if (stats.toolMs > 0) durations.push(`工具 ${formatDuration(stats.toolMs)}`)
  if (durations.length > 0) groups.push(durations.join(' · '))

  const speeds: string[] = []
  if (stats.ttftSteps > 0) speeds.push(`首字 ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
  if (stats.decodeMs > 0) speeds.push(`${formatTokens(Math.round(stats.decodeTokens / (stats.decodeMs / 1_000)))} tok/s`)
  if (speeds.length > 0) groups.push(speeds.join(' · '))

  const usage = stats.usage
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    const parts: string[] = []
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) parts.push(`缓存命中 ${cacheHit}%`)
    parts.push(
      `输入 ${formatTokens(usage.inputTokens)} tok / 输出 ${formatTokens(usage.outputTokens)} tok`,
    )
    groups.push(parts.join(' · '))
  }

  return (
    <div className={css.root} title={groups.join(' | ')}>
      {groups.join(' | ')}
    </div>
  )
})
