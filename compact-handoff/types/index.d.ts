export type ContextReading = { tokens: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    'compact-handoff': {
      context: ContextReading | null
      snoozedUntil: number | null
      isCompacting: boolean
      files: string[]
    }
  }
}
