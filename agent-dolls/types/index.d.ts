export type Doll = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
}

export type Line = {
  role: 'user' | 'assistant' | 'tool'
  text: string
  isError?: boolean
}

export type Detail = {
  agentId: string
  lines: Line[]
  deny?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dolls': {
      dolls: Doll[]
      isMainBusy: boolean
      selected: string | null
      detail: Detail | null
    }
  }
}
