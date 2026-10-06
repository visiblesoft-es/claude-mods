import type { AgentInfo, SessionMessage } from 'claude-code'

import type { Doll, Line } from '../../types'

export const MAIN = 'main'
const MAX_LINES = 60

export const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: 'working', color: 'green' },
  pending: { label: 'starting', color: 'yellow' },
  waiting: { label: 'waiting', color: 'yellow' },
  idle: { label: 'idle', color: 'gray' },
  completed: { label: 'finished', color: 'gray' },
  failed: { label: 'failed', color: 'red' },
  killed: { label: 'stopped', color: 'red' },
}

export function toDoll(agent: AgentInfo): Doll {
  return { id: agent.id, type: agent.type, description: agent.description, status: agent.status, parentId: agent.parentId }
}

function briefInput(input: Record<string, unknown>): string {
  const first = ['description', 'command', 'file_path', 'pattern', 'path', 'url', 'prompt']
    .map(k => input[k])
    .find(v => typeof v === 'string')
  return typeof first === 'string' ? first : ''
}

export function toLines(messages: SessionMessage[]): Line[] {
  const lines: Line[] = []
  for (const m of messages) {
    if (m.text) lines.push({ role: m.role, text: m.text })
    for (const use of m.toolUses) {
      lines.push({ role: 'tool', text: `${use.tool} ${briefInput(use.input)}`.trim(), isError: use.isError === true })
    }
  }
  return lines.slice(-MAX_LINES)
}
