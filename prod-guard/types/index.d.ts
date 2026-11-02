export type EntryStatus = 'running' | 'done' | 'refused'

export type Entry = {
  id: string
  at: number
  command: string
  target: string
  isWrite: boolean
  status: EntryStatus
}

declare module 'claude-code' {
  interface PluginState {
    'prod-guard': {
      log: Entry[]
      unlockedUntil: number | null
    }
  }
}
