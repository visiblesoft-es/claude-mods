import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Detail, Doll, Line } from '../types'
import { miniRobot, robot } from './lib/robot'

const LIST = 'agent-dolls'
const MAIN = 'main'
const POLL_MS = 1500
const MAX_LINES = 60

const dolls = atom({ plugin: 'agent-dolls', key: 'dolls' } as const, [])
const isMainBusy = atom({ plugin: 'agent-dolls', key: 'isMainBusy' } as const, false)
const selected = atom({ plugin: 'agent-dolls', key: 'selected' } as const, null)
const detail = atom({ plugin: 'agent-dolls', key: 'detail' } as const, null)
const frame = atom({ plugin: 'agent-dolls', key: 'frame' } as const, 0)

const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: 'working', color: 'success' },
  pending: { label: 'starting', color: 'warning' },
  waiting: { label: 'waiting', color: 'warning' },
  idle: { label: 'idle', color: 'subtle' },
  completed: { label: 'finished', color: 'subtle' },
  failed: { label: 'failed', color: 'error' },
  killed: { label: 'stopped', color: 'error' },
}

function toDoll(agent: AgentInfo): Doll {
  return {
    id: agent.id,
    type: agent.type,
    description: agent.description,
    status: agent.status,
    parentId: agent.parentId,
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function briefInput(input: Record<string, unknown>): string {
  const first = ['description', 'command', 'file_path', 'pattern', 'path', 'url', 'prompt']
    .map(k => input[k])
    .find(v => typeof v === 'string')
  return typeof first === 'string' ? first : ''
}

function toLines(messages: SessionMessage[]): Line[] {
  const lines: Line[] = []
  for (const m of messages) {
    if (m.text) lines.push({ role: m.role, text: m.text })
    for (const use of m.toolUses) {
      lines.push({
        role: 'tool',
        text: `${use.tool} ${briefInput(use.input)}`.trim(),
        isError: use.isError === true,
      })
    }
  }
  return lines.slice(-MAX_LINES)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function refresh($: EngineInterface) {
  const next = (await $.agent.list()).map(toDoll)
  if (!same(next, await read($, dolls))) await update($, dolls, () => next)
  // Only a working robot animates, so only then is it worth a redraw.
  const isAnyWorking = (await read($, isMainBusy)) || next.some(d => d.status === 'running')
  if (isAnyWorking) await update($, frame, n => n + 1)

  const id = await read($, selected)
  if (id === null || id === MAIN) return
  const answer = await $.session.messages({ agentId: id })
  const fresh: Detail = Array.isArray(answer)
    ? { agentId: id, lines: toLines(answer) }
    : { agentId: id, lines: (await read($, detail))?.lines ?? [], deny: answer.deny }
  if (!same(fresh, await read($, detail))) await update($, detail, () => fresh)
}

async function select($: EngineInterface, doll: Doll | null) {
  const isSame = doll !== null && (await read($, selected)) === doll.id
  if (doll === null || isSame) {
    await update($, selected, () => MAIN)
    await update($, detail, () => null)
    return
  }
  await update($, selected, () => doll.id)
  await update($, detail, () => ({ agentId: doll.id, lines: [] }))
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dolls',
      description: 'Open the pane with one doll for the main agent and each subagent',
    })
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'dolls' }, async $ => {
    await refresh($)
    await $.ui.open({ id: LIST, title: 'Agents' })

    return { text: 'Agents pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isMainBusy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isMainBusy, () => false)
    void refresh($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    void refresh($)
    return spawned
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === LIST) await select($, null)
    return next(e)
  })

  // A single pane: the terminal shows one mod pane at a time (the rest become
  // tabs), so the robots and the conversation share it.
  on('ui.render', { component: 'Pane', requestId: LIST }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, dolls)
    const current = (await read($, selected)) ?? MAIN
    const tick = await read($, frame)
    const shown = await read($, detail)
    const viewed = e.props.view.agentId ?? MAIN
    const main: Doll = {
      id: MAIN,
      type: 'main',
      description: 'Main agent',
      status: (await read($, isMainBusy)) ? 'running' : 'idle',
    }
    const columns = e.props.bodyColumns ?? 40
    const width = Math.max(12, columns - 6)
    const isCompact = shown !== null
    const depth = (d: Doll): number =>
      d.parentId ? 1 + depth(list.find(p => p.id === d.parentId) ?? { ...d, parentId: undefined }) : 1

    const dollRow = (d: Doll) => {
      const s = STATUS[d.status] ?? { label: d.status, color: 'subtle' }
      const isCurrent = d.id === current
      const indent = d.id === MAIN ? 0 : Math.min(depth(d), 3) * 2
      const pick = (
        <Button
          key={`pick-${d.id}`}
          label={d.id === MAIN ? 'Main' : d.type}
          variant={isCurrent ? 'primary' : 'secondary'}
          onPress={() => select($, d.id === MAIN ? null : d)}
        />
      )
      const state = (
        <Text color={s.color}>
          {isCurrent ? '▶ ' : ''}
          {s.label}
          {d.id === viewed ? ' · 👁 on screen' : ''}
        </Text>
      )

      if (isCompact) {
        const mini = miniRobot(d.type, d.status, tick)
        return (
          <Box key={`doll-${d.id}`} flexDirection="row" gap={1} marginLeft={indent}>
            <Text color={mini.color} dimColor={mini.isDim} bold={isCurrent}>{mini.rows[0]}</Text>
            {pick}
            {state}
          </Box>
        )
      }

      const bot = robot(d.type, d.status, tick)
      return (
        <Box key={`doll-${d.id}`} flexDirection="row" gap={1} marginLeft={indent}>
          <Box flexDirection="column" flexShrink={0}>
            {bot.rows.map((row, i) => (
              <Text key={`r${i}`} color={bot.color} dimColor={bot.isDim} bold={isCurrent}>
                {row}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {pick}
            <Text dimColor wrap="truncate-end">{clip(d.description, width)}</Text>
            {state}
          </Box>
        </Box>
      )
    }

    const agents = [main, ...list]
    const dollRows = isCompact ? agents.length : agents.length * 5
    const room = Math.max(3, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30) - dollRows - 4)
    const owner = shown ? list.find(d => d.id === shown.agentId) : undefined

    return (
      <Box flexDirection="column" gap={isCompact ? 0 : 1}>
        {agents.map(dollRow)}
        {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
        {shown && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{'─'.repeat(Math.max(4, columns - 2))}</Text>
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexDirection="row" gap={1}>
                <Text color={miniRobot(owner?.type ?? '', owner?.status ?? 'idle', tick).color}>
                  {miniRobot(owner?.type ?? '', owner?.status ?? 'idle', tick).rows[0]}
                </Text>
                <Text bold wrap="truncate-end">{clip(owner?.description ?? 'Subagent', width - 16)}</Text>
              </Box>
              <Button key="back" label="Close" role="dismiss" onPress={() => select($, null)} />
            </Box>
            {shown.deny && <Text color="warning">{clip(shown.deny, width * 2)}</Text>}
            {shown.lines.length === 0 && !shown.deny && <Text dimColor>Loading…</Text>}
            {shown.lines.slice(-room).map(line =>
              line.role === 'tool' ? (
                <Text color={line.isError ? 'error' : 'subtle'} wrap="truncate-end">
                  › {clip(line.text, width)}
                </Text>
              ) : (
                <Text color={line.role === 'user' ? 'suggestion' : 'text'} wrap="wrap">
                  {line.role === 'user' ? '» ' : ''}
                  {clip(line.text, width * 3)}
                </Text>
              ),
            )}
          </Box>
        )}
      </Box>
    )
  })
}
