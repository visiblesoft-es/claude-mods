import type { Stats } from '../../types'

export const EMPTY_STATS: Stats = {
  model: null,
  effort: null,
  outputTokens: 0,
  lastTurn: null,
  tools: {},
  subagentTools: {},
  agents: {},
  skills: [],
  added: 0,
  removed: 0,
  compactions: 0,
  turns: 0,
}


export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
