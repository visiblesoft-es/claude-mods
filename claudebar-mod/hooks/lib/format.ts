// Formatting shared with the bash claudebar: 8-cell bars, same thresholds.

export const BAR_WIDTH = 8

export function bar(percent: number, width = BAR_WIDTH): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

// Usage traffic light: green <70, yellow 70–89, red ≥90.
export function usageColor(percent: number): string {
  if (percent >= 90) return 'red'
  if (percent >= 70) return 'yellow'
  return 'green'
}

// Cache is the other way round, higher is better: green ≥80, yellow ≥50, red <50.
export function cacheColor(percent: number): string {
  if (percent >= 80) return 'green'
  if (percent >= 50) return 'yellow'
  return 'red'
}

const EFFORT_COLORS: Record<string, string> = {
  low: 'green',
  medium: 'cyan',
  high: 'yellow',
  xhigh: 'redBright',
  max: 'red',
}

export function effortColor(level: string): string {
  return EFFORT_COLORS[level] ?? 'gray'
}

export function kt(tokens: number): string {
  return `${Math.round(tokens / 1000)}kt`
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

export function countdown(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return null
  const mins = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// "claude-opus-5-5[1m]" → "Opus 5.5 1M"
export function modelName(id: string): string {
  const isLong = /\[1m\]/i.test(id)
  const parts = id
    .replace(/\[1m\]/i, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
  const family = parts.find(p => /^[a-z]+$/i.test(p))
  const version = parts.filter(p => /^\d+$/.test(p)).join('.')
  if (!family) return id
  const name = family[0]!.toUpperCase() + family.slice(1)
  return [name, version, isLong ? '1M' : ''].filter(Boolean).join(' ')
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (max <= 1) return ''
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

export function lineCount(text: unknown): number {
  if (typeof text !== 'string' || text === '') return 0
  return text.split('\n').length
}

export type CompactHint = { label: string; color: string; score: number }

// Same score as statusline.sh: context (1–3), cache <60 (+1), >90 min (+1).
// Silent below 30% context.
export function compactHint(ctx: number, cacheRate: number | null, minutes: number): CompactHint | null {
  if (ctx < 30) return null
  let score = 0
  if (ctx >= 85) score += 3
  else if (ctx >= 70) score += 2
  else if (ctx >= 50) score += 1
  if (cacheRate !== null && cacheRate < 60) score += 1
  if (minutes > 90) score += 1
  if (score >= 4) return { label: '⚠ COMPACT', color: 'red', score }
  if (score >= 2) return { label: '⚡ /compact', color: 'yellow', score }
  if (score >= 1) return { label: '✦ compact?', color: 'gray', score }
  return null
}

export function cacheRate(t: { input: number; cacheRead: number; cacheCreation: number } | null): number | null {
  if (!t) return null
  const total = t.input + t.cacheRead + t.cacheCreation
  return total > 0 ? Math.round((t.cacheRead / total) * 100) : null
}

export function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function topCounts(counts: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
}

// "1 session", "2 sessions"
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
