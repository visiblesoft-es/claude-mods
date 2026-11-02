export type Touch = { target: string; at: number; commands: number; writes: number }

declare module 'claude-code' {
  interface PluginState {
    'prod-guard': {
      touch: Touch | null
      unlockedUntil: number | null
    }
  }
}
