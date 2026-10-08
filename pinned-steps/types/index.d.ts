export type StepStatus = 'todo' | 'done' | 'failed' | 'skipped'

export type Step = { text: string; detail?: string; status: StepStatus }

export type Procedure = { id: string; title: string; createdAt: number; steps: Step[] }

declare module 'claude-code' {
  interface PluginState {
    'pinned-steps': {
      stack: Procedure[]
      expanded: string | null
    }
  }
}
