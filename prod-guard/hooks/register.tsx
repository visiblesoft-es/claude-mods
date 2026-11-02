import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { Entry } from '../types'
import { assess, mentionsDocker, parseTargets } from './lib/classify'
import type { Assessment, Targets } from './lib/classify'
import { addEntry, clip, clockTime, entryHeading, finishEntry, isStale, logText, settleRunning, summary } from './lib/log'

// $ may only be passed to functions declared in this file; lib/classify.ts is pure.

const log = atom({ plugin: 'prod-guard', key: 'log' } as const, [])
const unlockedUntil = atom({ plugin: 'prod-guard', key: 'unlockedUntil' } as const, null)

const PANE = 'prod-guard'
const UNLOCK_MINUTES = 15
const MINUTE = 60_000

let targets: Targets = { hosts: [], contexts: [], patterns: [], invalid: [] }
let announced = false
let ids = 0
let bandMinutes = 30

async function currentContext($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.process.run(['docker', 'context', 'show'], { timeoutMs: 2000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

async function assessCommand($: EngineInterface, command: string): Promise<Assessment | null> {
  const context = targets.contexts.length > 0 && mentionsDocker(command) ? await currentContext($) : null
  return assess(command, targets, context)
}

async function isUnlocked($: EngineInterface): Promise<boolean> {
  const until = await read($, unlockedUntil)
  return until !== null && (await $.clock.now()) < until
}

// The verdict for a command, or null when the engine's own stands.
async function verdict($: EngineInterface, input: unknown, approver: string | undefined) {
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return null
  const found = await assessCommand($, command)
  if (!found?.isWrite || (await isUnlocked($))) return null
  const reason = `prod-guard: this command may change production (${found.target}).`
  return approver
    ? ({ decision: 'ask', reason } as const)
    : ({ decision: 'deny', reason: `${reason} Nobody can be asked here, so it was refused.` } as const)
}

// A refusal by a permission check reaches a tool.call hook as an error result, not
// as `deny`, so its words are all there is to go by. A miss only counts one
// command too many in the band.
function wasRefused(ran: { deny?: string; text?: string }): boolean {
  return ran.deny !== undefined || /^(?:Error: )?(?:Permission |The user doesn't want to proceed)/.test(ran.text ?? '')
}

// The band shows from the moment a command starts, not when it ends: a deployment
// can take minutes.
async function start($: EngineInterface, command: string, found: Assessment): Promise<string> {
  const at = await $.clock.now()
  const id = `${at}-${++ids}`
  if (!announced) {
    announced = true
    $.ui.toast(`This session is touching production: ${found.target}`)
  }
  const entry: Entry = { id, at, command, target: found.target, isWrite: found.isWrite, status: 'running' }
  await update($, log, l => addEntry(l, entry))
  return id
}

async function clearLog($: EngineInterface) {
  await update($, log, () => [])
  announced = false
}

// Band and unlock expire when something next happens: no timer needed.
async function prune($: EngineInterface) {
  const now = await $.clock.now()
  if (isStale(await read($, log), now, bandMinutes * MINUTE)) await clearLog($)
  const until = await read($, unlockedUntil)
  if (until !== null && now >= until) await update($, unlockedUntil, () => null)
}

async function unlock($: EngineInterface, minutes: number) {
  const now = await $.clock.now()
  await update($, unlockedUntil, () => now + minutes * MINUTE)
}

async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: 'Production commands', focus: true })
  if (!opened.isPlaced) $.ui.toast(`The pane is open but cannot be shown: ${opened.reason}. /prod-guard log lists the commands.`, { timeoutMs: 8000 })
}

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, below: RenderElement) {
  const entries = await read($, log)
  const until = await read($, unlockedUntil)
  if (entries.length === 0 && until === null) return below
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold color="error">⚠ PRODUCTION</Text>
        {entries.length > 0 ? <Text>{summary(entries)}</Text> : null}
        {until !== null ? <Text bold color="error">writes unlocked until {clockTime(until)}</Text> : null}
        {entries.length > 0 ? <Button key="details" label="Details" onPress={() => openPane($)} /> : null}
        {until !== null ? (
          <Button key="lock" label="Lock" variant="primary" onPress={() => update($, unlockedUntil, () => null)} />
        ) : (
          <Button key="unlock" label={`Unlock ${UNLOCK_MINUTES} min`} onPress={() => unlock($, UNLOCK_MINUTES)} />
        )}
        {entries.length > 0 ? <Button key="clear" label="Clear" onPress={() => clearLog($)} /> : null}
      </Box>
      {below}
    </Box>
  )
}

async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text } = $.ui.resolve(e)
  const entries = [...(await read($, log))].reverse()
  if (entries.length === 0) {
    return <Text dimColor wrap="wrap">No commands have touched production since the last Clear.</Text>
  }
  const room = Math.max(20, e.props.bodyColumns * 4)
  return (
    <Box flexDirection="column" gap={1}>
      {entries.map(entry => (
        <Box key={entry.id} flexDirection="column">
          <Text bold={entry.status === 'running'} dimColor={entry.status !== 'running'}>{entryHeading(entry)}</Text>
          <Text wrap="wrap">{clip(entry.command, room)}</Text>
        </Box>
      ))}
    </Box>
  )
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb, ...rest] = args.trim().split(/\s+/)
  if (verb === 'unlock') {
    const minutes = Number(rest[0] ?? UNLOCK_MINUTES)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) return 'Usage: /prod-guard unlock [minutes, up to 240]'
    await unlock($, minutes)
    return `Writes to production will not ask for ${minutes} min. /prod-guard lock ends it.`
  }
  if (verb === 'lock') {
    await update($, unlockedUntil, () => null)
    return 'Locked: commands that may change production ask again.'
  }
  if (verb === 'log') return logText(await read($, log))
  if (verb === 'test') {
    const command = args.trim().slice('test'.length).trim()
    if (!command) return 'Usage: /prod-guard test <command>'
    const found = await assessCommand($, command)
    if (!found) return 'Not production: runs as usual.'
    return found.isWrite ? `Production (${found.target}), possible write: asks you.` : `Production (${found.target}), read-only: runs, and shows in the band.`
  }
  const lines = [
    `Hosts: ${targets.hosts.join(', ') || '(none)'}`,
    `Docker contexts: ${targets.contexts.join(', ') || '(none)'}`,
    `Patterns: ${targets.patterns.map(p => p.source).join(', ') || '(none)'}`,
    (await isUnlocked($)) ? 'Writes: unlocked' : 'Writes: ask',
  ]
  if (targets.invalid.length > 0) lines.push(`Ignored, not valid regular expressions: ${targets.invalid.join(' ')}`)
  if (targets.hosts.length + targets.contexts.length + targets.patterns.length === 0) {
    lines.push('Nothing is guarded yet: set the production hosts in /config.')
  }
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  targets = parseTargets(options.hosts, options.dockerContexts, options.patterns)
  if (typeof options.bandMinutes === 'number' && options.bandMinutes > 0) bandMinutes = options.bandMinutes

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prod-guard',
      description: 'Production guard: show what is guarded, list commands, unlock or lock writes, or test a command',
      argumentHint: '[log|unlock [min]|lock|test <command>]',
    })
    await update($, log, settleRunning)
    if (targets.invalid.length > 0) $.ui.toast(`prod-guard ignores invalid patterns: ${targets.invalid.join(' ')}`)
    return next(e)
  })

  on('command.run', { command: 'prod-guard' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  // The permission decision: `ask` from a hook goes to the person, in auto mode
  // too. It only tightens: what the rules or other plugins refuse stays refused.
  const refuse = { decision: 'deny', reason: 'prod-guard: its check failed, so the command was refused.' } as const
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const beneath = await next(e)
    if (beneath.decision === 'deny') return beneath
    return (await verdict($, e.input, e.approver)) ?? beneath
  }).catch(() => refuse)
  on('tool.check', { tool: 'Monitor' }, async ($, e, next) => {
    const beneath = await next(e)
    if (beneath.decision === 'deny') return beneath
    return (await verdict($, e.input, e.approver)) ?? beneath
  }).catch(() => refuse)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = await assessCommand($, e.command)
    if (!found) return next(e)
    const id = await start($, e.command, found)
    try {
      const ran = await next(e)
      await update($, log, l => finishEntry(l, id, wasRefused(ran) ? 'refused' : 'done'))
      return ran
    } catch (error) {
      await update($, log, l => finishEntry(l, id, 'done'))
      throw error
    }
  })
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const found = e.command ? await assessCommand($, e.command) : null
    if (!found || !e.command) return next(e)
    const id = await start($, e.command, found)
    try {
      const ran = await next(e)
      await update($, log, l => finishEntry(l, id, wasRefused(ran) ? 'refused' : 'done'))
      return ran
    } catch (error) {
      await update($, log, l => finishEntry(l, id, 'done'))
      throw error
    }
  })

  on('turn.complete', async ($, e, next) => {
    await prune($)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await prune($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    return renderBand($, e, below)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
