// Pure logic: nothing here talks to the engine.

import type { Entry, EntryStatus } from '../../types'

const MAX_ENTRIES = 50
const MAX_COMMAND = 2000

export function addEntry(log: readonly Entry[], entry: Entry): Entry[] {
  return [...log, { ...entry, command: entry.command.slice(0, MAX_COMMAND) }].slice(-MAX_ENTRIES)
}

export function finishEntry(log: readonly Entry[], id: string, status: EntryStatus): Entry[] {
  return log.map(e => (e.id === id ? { ...e, status } : e))
}

// Nothing can still be running once the module has started again.
export function settleRunning(log: readonly Entry[]): Entry[] {
  return log.map(e => (e.status === 'running' ? { ...e, status: 'done' as const } : e))
}

export function isStale(log: readonly Entry[], now: number, maxAgeMs: number): boolean {
  const last = log[log.length - 1]
  return last !== undefined && now - last.at > maxAgeMs && !log.some(e => e.status === 'running')
}

export function summary(log: readonly Entry[]): string {
  const count = (status: EntryStatus) => log.filter(e => e.status === status).length
  const parts = [
    count('running') > 0 ? `${count('running')} running` : '',
    count('done') > 0 ? `${count('done')} done` : '',
    count('refused') > 0 ? `${count('refused')} refused` : '',
  ].filter(Boolean)
  return [log[log.length - 1]?.target, parts.join(', ')].filter(Boolean).join(' · ')
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

const STATUS: Record<EntryStatus, string> = { running: 'running', done: 'done', refused: 'refused' }

export function entryHeading(e: Entry): string {
  return `${clockTime(e.at)} ${STATUS[e.status]} · ${e.target} · ${e.isWrite ? 'may write' : 'read-only'}`
}

// Newest first, for /prod-guard log.
export function logText(log: readonly Entry[]): string {
  if (log.length === 0) return 'No commands have touched production since the last Clear.'
  return [...log].reverse().map(e => `${entryHeading(e)}\n  ${clip(e.command, 200)}`).join('\n')
}
