import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { assess, mentionsDocker, parseTargets } from './lib/classify'
import type { Assessment, Targets } from './lib/classify'

// $ may only be passed to functions declared in this file; lib/classify.ts is pure.

const touch = atom({ plugin: 'prod-guard', key: 'touch' } as const, null)
const unlockedUntil = atom({ plugin: 'prod-guard', key: 'unlockedUntil' } as const, null)

const UNLOCK_MINUTES = 15
const MINUTE = 60_000

let targets: Targets = { hosts: [], contexts: [], patterns: [] }
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

async function record($: EngineInterface, found: Assessment) {
  const at = await $.clock.now()
  const before = await read($, touch)
  await update($, touch, t => ({
    target: found.target,
    at,
    commands: (t?.commands ?? 0) + 1,
    writes: (t?.writes ?? 0) + (found.isWrite ? 1 : 0),
  }))
  if (!before) $.ui.toast(`This session is touching production: ${found.target}`)
}

// Band and unlock expire when something next happens: no timer needed.
async function prune($: EngineInterface) {
  const now = await $.clock.now()
  const t = await read($, touch)
  if (t && now - t.at > bandMinutes * MINUTE) await update($, touch, () => null)
  const until = await read($, unlockedUntil)
  if (until !== null && now >= until) await update($, unlockedUntil, () => null)
}

async function unlock($: EngineInterface, minutes: number) {
  const now = await $.clock.now()
  await update($, unlockedUntil, () => now + minutes * MINUTE)
}

const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, below: RenderElement) {
  const t = await read($, touch)
  const until = await read($, unlockedUntil)
  if (!t && until === null) return below
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold color="error">⚠ PRODUCTION</Text>
        {t ? (
          <Text>
            {t.target} · {plural(t.commands, 'command')} · {plural(t.writes, 'possible write')}
          </Text>
        ) : null}
        {until !== null ? <Text bold color="error">writes unlocked until {clockTime(until)}</Text> : null}
        {until !== null ? (
          <Button key="lock" label="Lock" variant="primary" onPress={() => update($, unlockedUntil, () => null)} />
        ) : (
          <Button key="unlock" label={`Unlock ${UNLOCK_MINUTES} min`} onPress={() => unlock($, UNLOCK_MINUTES)} />
        )}
        {t ? <Button key="clear" label="Clear" onPress={() => update($, touch, () => null)} /> : null}
      </Box>
      {below}
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
      description: 'Production guard: show what is guarded, unlock or lock writes, or test a command',
      argumentHint: '[unlock [min]|lock|test <command>]',
    })
    return next(e)
  })

  on('command.run', { command: 'prod-guard' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  // The permission decision: `ask` from a hook goes to the person, in auto mode too.
  const refuse = { decision: 'deny', reason: 'prod-guard: its check failed, so the command was refused.' } as const
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => (await verdict($, e.input, e.approver)) ?? next(e)).catch(() => refuse)
  on('tool.check', { tool: 'Monitor' }, async ($, e, next) => (await verdict($, e.input, e.approver)) ?? next(e)).catch(() => refuse)

  // What actually ran feeds the band; a refused command does not.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = await assessCommand($, e.command)
    const ran = await next(e)
    if (found && ran.deny === undefined) await record($, found)
    return ran
  })
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const found = e.command ? await assessCommand($, e.command) : null
    const ran = await next(e)
    if (found && ran.deny === undefined) await record($, found)
    return ran
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
}
