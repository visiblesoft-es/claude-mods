export type GitFile = { status: string; path: string }

export type GitInfo = {
  dir: string
  isRepo: boolean
  branch: string | null
  isDirty: boolean
  modified: number
  ahead: number
  added: number
  removed: number
  lastSubject: string | null
  worktree: string | null
  files: GitFile[]
  commits: string[]
}

export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type UsageSnap = {
  ctxPercent: number | null
  ctxTokens: number | null
  window: number
  limits: Limit[]
  startedAt: number
  costUsd: number | null
  now: number
}

export type TurnTokens = { input: number; output: number; cacheRead: number; cacheCreation: number }

export type Stats = {
  model: string | null
  effort: string | null
  outputTokens: number
  lastTurn: TurnTokens | null
  tools: Record<string, number>
  subagentTools: Record<string, number>
  agents: Record<string, number>
  skills: string[]
  added: number
  removed: number
  compactions: number
  turns: number
}

export type View = 'context' | 'tools' | 'git' | 'agents' | 'history'

export type Doll = { id: string; type: string; description: string; status: string; parentId?: string }

export type Line = { role: 'user' | 'assistant' | 'tool'; text: string; isError?: boolean }

export type Detail = { agentId: string; lines: Line[]; deny?: string }

export type DayStats = {
  date: string
  sessions: number
  turns: number
  outputTokens: number
  toolCalls: number
  compactions: number
}

declare module 'claude-code' {
  interface PluginState {
    'claudebar-mod': {
      git: GitInfo | null
      usage: UsageSnap | null
      stats: Stats
      view: View
      isMainBusy: boolean
      dolls: Doll[]
      selected: string | null
      detail: Detail | null
      history: DayStats[]
      alerted: string[]
    }
  }
}
