import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, SessionCompactResult } from 'claude-code'

import { buildInstructions, formatTokens, handoffLimit, planPaths, rememberPaths, shouldWarn } from './lib/handoff'
import type { GitSnapshot } from './lib/handoff'

// $ may only be passed to functions declared in this file; lib/handoff.ts is pure.

const context = atom({ plugin: 'compact-handoff', key: 'context' } as const, null)
const snoozedUntil = atom({ plugin: 'compact-handoff', key: 'snoozedUntil' } as const, null)
const isCompacting = atom({ plugin: 'compact-handoff', key: 'isCompacting' } as const, false)
const files = atom({ plugin: 'compact-handoff', key: 'files' } as const, [])

let threshold = 300_000
let snoozeStep = 100_000

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 3000 })
    return r.exitCode === 0 ? r.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

async function snapshot($: EngineInterface): Promise<GitSnapshot> {
  const cwd = await $.session.cwd()
  const [branch, head, status, unpushed] = await Promise.all([
    git($, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, cwd, ['log', '-1', '--format=%h %s']),
    git($, cwd, ['status', '--porcelain']),
    git($, cwd, ['rev-list', '--count', '@{upstream}..HEAD']),
  ])
  return {
    branch,
    head,
    changedFiles: status === undefined ? undefined : status.split('\n').filter(Boolean).length,
    unpushed: unpushed === undefined ? undefined : Number(unpushed),
  }
}

async function measure($: EngineInterface) {
  const { context: c } = await $.session.usage()
  if (c.tokens !== undefined) await update($, context, () => ({ tokens: c.tokens!, window: c.window }))
}

async function see($: EngineInterface, text: string) {
  const seen = planPaths(text)
  if (seen.length > 0) await update($, files, known => rememberPaths(known, seen))
}

async function handoffInstructions($: EngineInterface, existing?: string) {
  return buildInstructions(existing, await snapshot($), await read($, files))
}

async function afterCompaction($: EngineInterface, result: SessionCompactResult) {
  if (result.skip !== undefined) return
  await update($, snoozedUntil, () => null)
  if (result.tokensAfter !== undefined) {
    await update($, context, c => (c ? { ...c, tokens: result.tokensAfter! } : c))
  }
  if (result.tokensBefore !== undefined && result.tokensAfter !== undefined) {
    $.ui.toast(`Handoff: ${formatTokens(result.tokensBefore)} → ${formatTokens(result.tokensAfter)}`)
  }
}

// $.session.compact skips the calling plugin's own session.compact hook, so
// this path writes the handoff itself. Answers what to tell the person.
async function compactNow($: EngineInterface, focus?: string): Promise<string> {
  if (await read($, isCompacting)) return 'Already compacting.'
  await update($, isCompacting, () => true)
  try {
    const result = await $.session.compact({ instructions: await handoffInstructions($, focus) })
    await afterCompaction($, result)
    return result.skip !== undefined ? `Not compacted: ${result.skip}` : 'Handoff written; the conversation is compacted.'
  } catch {
    return 'Could not compact now. Wait for the turn to end and try again.'
  } finally {
    await update($, isCompacting, () => false)
  }
}

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, below: RenderElement) {
  const reading = await read($, context)
  if (!reading || e.props.isWorking) return below
  if (!shouldWarn(reading.tokens, reading.window, threshold, await read($, snoozedUntil))) return below
  const { Box, Text, Button } = $.ui.resolve(e)
  const limit = formatTokens(handoffLimit(threshold, reading.window))
  const busy = await read($, isCompacting)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color="warning">⚠ Context {formatTokens(reading.tokens)}</Text>
        <Text dimColor>past the {limit} handoff threshold</Text>
        {busy ? (
          <Text dimColor>Compacting…</Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Button
              key="handoff"
              label="Handoff & compact"
              variant="primary"
              onPress={async () => {
                const said = await compactNow($)
                if (said.startsWith('Could not') || said.startsWith('Not compacted')) $.ui.toast(said)
              }}
            />
            <Button
              key="snooze"
              label={`Snooze ${formatTokens(snoozeStep)}`}
              onPress={() => update($, snoozedUntil, () => reading.tokens + snoozeStep)}
            />
          </Box>
        )}
      </Box>
      {below}
    </Box>
  )
}

export const register: Register = (on, options) => {
  if (typeof options.threshold === 'number' && options.threshold > 0) threshold = options.threshold
  if (typeof options.snoozeStep === 'number' && options.snoozeStep > 0) snoozeStep = options.snoozeStep

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Compact now, keeping the plan, branch, pending checks and decisions',
      argumentHint: '[what else to keep]',
    })
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => ({ text: await compactNow($, e.args.trim() || undefined) }))

  // Compactions started elsewhere get the handoff too: /compact, claudebar's
  // button or the auto threshold. Subagents keep their own.
  on('session.compact', async ($, e, next) => {
    if (e.agentId) return next(e)
    const result = await next({ ...e, instructions: await handoffInstructions($, e.instructions) })
    if (e.trigger !== 'precompute') await afterCompaction($, result)
    return result
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    await see($, e.file_path)
    return next(e)
  })
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    await see($, e.file_path)
    return next(e)
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    await see($, e.file_path)
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await see($, e.command)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await measure($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    return renderBand($, e, below)
  })
}
