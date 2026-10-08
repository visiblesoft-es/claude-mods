import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderElement, RenderInput } from 'claude-code'

import type { Procedure, Step, StepStatus } from '../types'
import {
  INSTRUCTIONS, copyTarget, currentIndex, doneCount, drop, isFinished, mark, markUpTo, parseBlocks, parseLastList,
  pin, progressNote, resume, settle,
} from './lib/steps'
import type { Parsed } from './lib/steps'

// $ may only be passed to functions declared in this file, so everything that
// talks to the engine lives here; lib/steps.ts holds the parsing and the stack.

// ── state ──

const PANE = 'pinned-steps'

const stack = atom({ plugin: 'pinned-steps', key: 'stack' } as const, [])
const expanded = atom({ plugin: 'pinned-steps', key: 'expanded' } as const, null)

let options: PluginOptions = {}
// The main agent's last answer, for `/steps pin`.
let lastAnswer = ''
let ids = 0

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (max <= 1) return ''
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// The stack is kept per project, so it survives restarts and new sessions in
// the same directory.
async function storeKey($: EngineInterface) {
  return `stack:${await $.session.cwd()}`
}

async function load($: EngineInterface) {
  const saved = ((await $.store.get(await storeKey($))) as Procedure[] | undefined) ?? []
  await update($, stack, () => saved)
}

// Every change goes through here: finished procedures leave the stack, and
// the person is told which one is back on top.
async function change($: EngineInterface, fn: (s: Procedure[]) => Procedure[]) {
  const before = await read($, stack)
  const { stack: next, finished } = settle(fn(before))
  await update($, stack, () => next)
  await $.store.set(await storeKey($), next)
  for (const p of finished) {
    const top = next[0]
    const back = top && before[0]?.id !== top.id ? ` Back to "${top.title}", step ${currentIndex(top) + 1}/${top.steps.length}.` : ''
    $.ui.toast(`✓ Finished: ${p.title}.${back}`, { timeoutMs: 8000 })
  }
}

async function pinAll($: EngineInterface, found: Parsed[]) {
  const now = await $.clock.now()
  for (const parsed of found) {
    let isRevision = false
    await change($, s => {
      const r = pin(s, parsed, `${now}-${(ids += 1)}`, now)
      isRevision = r.isRevision
      return r.stack
    })
    const below = (await read($, stack))[1]
    const paused = !isRevision && below ? ` "${below.title}" is paused under it.` : ''
    $.ui.toast(`${isRevision ? 'Updated' : 'Pinned'}: ${parsed.title} (${parsed.steps.length} steps).${paused}`, { timeoutMs: 6000 })
  }
}

async function top($: EngineInterface): Promise<{ p: Procedure; i: number } | null> {
  const p = (await read($, stack))[0]
  if (!p) return null
  const i = currentIndex(p)
  return i < 0 ? null : { p, i }
}

async function setStatus($: EngineInterface, procId: string, index: number, status: StepStatus) {
  await change($, s => (status === 'done' ? markUpTo(s, procId, index) : mark(s, procId, index, status)))
}

// Marks the current step done and tells Claude, so it picks up from there.
async function continueNext($: EngineInterface) {
  const t = await top($)
  if (!t) return
  const { p, i } = t
  await setStatus($, p.id, i, 'done')
  const after = (await read($, stack))[0]
  const step = `step ${i + 1} of "${p.title}" (${p.steps[i]!.text})`
  let text: string
  if (i + 1 >= p.steps.length) {
    text = after
      ? `I've done ${step}, so that procedure is finished. Let's go back to "${after.title}", step ${currentIndex(after) + 1}: ${after.steps[currentIndex(after)]!.text}.`
      : `I've done ${step}, the last one.`
  } else {
    text = `I've done ${step}. Let's continue with step ${i + 2}: ${p.steps[i + 1]!.text}.`
  }
  await $.prompt.submit({ text, asUser: true })
}

// Marks the current step failed and starts a prompt for the person to finish.
async function failCurrent($: EngineInterface) {
  const t = await top($)
  if (!t) return
  await setStatus($, t.p.id, t.i, 'failed')
  await $.prompt.fill({ text: `Step ${t.i + 1} of "${t.p.title}" (${t.p.steps[t.i]!.text}) failed: `, mode: 'replace' })
}

// Undoes the last step marked done or skipped.
async function back($: EngineInterface, p: Procedure) {
  const i = currentIndex(p)
  const prev = (i < 0 ? p.steps.length : i) - 1
  if (prev >= 0) await setStatus($, p.id, prev, 'todo')
}

async function copy($: EngineInterface, step: Step, surface: string) {
  const text = copyTarget(step)
  if (!text) return
  const r = await $.ui.copy({ text, surface: surface as never })
  $.ui.toast(r.isCopied ? `Copied: ${clip(text, 60)}` : `Not copied: ${r.reason}`)
}

// The press must await the open: a pane opened after the press has settled
// counts as opened unasked, and on a terminal under 144 columns it waits undrawn.
async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: 'Pinned steps', focus: true })
  if (!opened.isPlaced) {
    $.ui.toast(`The steps pane is open but cannot be shown: ${opened.reason}`, { timeoutMs: 8000 })
    return
  }
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (pane && !pane.isShown) {
    $.ui.toast('The steps pane is open as a tab behind another pane: press its tab or ctrl+x tab.', { timeoutMs: 8000 })
  }
}

// ── band ──

const MARK: Record<StepStatus, string> = { todo: '☐', done: '✓', failed: '✗', skipped: '↷' }
const MARK_COLOR: Record<StepStatus, string | undefined> = { todo: undefined, done: 'green', failed: 'red', skipped: undefined }

function progressBar(p: Procedure, width = 8) {
  const filled = Math.round((doneCount(p) / p.steps.length) * width)
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, below: RenderElement) {
  const s = await read($, stack)
  const p = s[0]
  if (!p) return below
  const i = currentIndex(p)
  if (i < 0) return below
  const step = p.steps[i]!
  const { Box, Text, Button } = $.ui.resolve(e)
  const columns = e.props.bodyColumns
  const hasCopy = copyTarget(step) !== null
  // The buttons take about 40 columns; the step's text gets the rest.
  const room = columns - 4 - (hasCopy ? 48 : 39)

  const rows: RenderElement[] = []
  if (options.showSeparator !== false) {
    rows.push(<Text key="separator" dimColor>{'─'.repeat(Math.max(1, columns))}</Text>)
  }
  rows.push(
    <Box key="title" flexDirection="row" gap={1}>
      <Text color="claude">▶</Text>
      <Text bold>{clip(p.title, Math.max(10, columns - 24))}</Text>
      <Text dimColor>
        {progressBar(p)} {i + 1}/{p.steps.length}
      </Text>
    </Box>,
  )
  rows.push(
    <Box key="step" flexDirection="row" gap={1}>
      <Text color={MARK_COLOR[step.status]}> {step.status === 'failed' ? MARK.failed : MARK.todo}</Text>
      <Text wrap="truncate-end">{clip(step.text, Math.max(12, room))}</Text>
      <Button key="done" label="✓ Done" onPress={() => setStatus($, p.id, i, 'done')} />
      <Button key="continue" label="Continue" variant="primary" onPress={() => continueNext($)} />
      {hasCopy && <Button key="copy" label="Copy" onPress={press => copy($, step, press.surface)} />}
      <Button key="open" label="Steps ›" onPress={() => openPane($)} />
    </Box>,
  )
  const paused = s.slice(1)
  if (paused.length > 0) {
    const first = paused[0]!
    const more = paused.length > 1 ? ` (+${paused.length - 1} more)` : ''
    rows.push(
      <Text key="paused" dimColor wrap="truncate-end">
        {clip(`  ↳ paused: ${first.title} · step ${currentIndex(first) + 1}/${first.steps.length}${more}`, columns)}
      </Text>,
    )
  }
  rows.push(below)
  return <Box flexDirection="column">{rows}</Box>
}

// ── pane ──

type Els = ReturnType<EngineInterface['ui']['resolve']>

function stepRows($: EngineInterface, { Box, Text, Button }: Els, p: Procedure, isTop: boolean, columns: number) {
  const current = currentIndex(p)
  return p.steps.map((step, i) => {
    const isCurrent = i === current
    const marker = isCurrent && step.status !== 'failed' ? '▶' : MARK[step.status]
    const color = isCurrent && step.status !== 'failed' ? 'claude' : MARK_COLOR[step.status]
    const isDim = step.status === 'done' || step.status === 'skipped'
    const target = copyTarget(step)
    return (
      <Box key={`${p.id}-s${i}`} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={color}>{marker}</Text>
          <Text dimColor={isDim} bold={isCurrent} wrap="wrap">
            {i + 1}. {step.text}
          </Text>
        </Box>
        {step.detail && (
          <Box paddingLeft={5}>
            <Text dimColor wrap="wrap">{step.detail}</Text>
          </Box>
        )}
        {isCurrent && isTop && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
            <Button key={`${p.id}-done`} label="✓ Done" onPress={() => setStatus($, p.id, i, 'done')} />
            <Button key={`${p.id}-continue`} label="Continue" variant="primary" onPress={() => continueNext($)} />
            <Button key={`${p.id}-fail`} label="✗ Failed" onPress={() => failCurrent($)} />
            <Button key={`${p.id}-skip`} label="Skip" onPress={() => setStatus($, p.id, i, 'skipped')} />
            {target && <Button key={`${p.id}-copy`} label="Copy" onPress={press => copy($, step, press.surface)} />}
            {i > 0 && <Button key={`${p.id}-back`} label="↶ Back" onPress={() => back($, p)} />}
          </Box>
        )}
      </Box>
    )
  })
}

async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const s = await read($, stack)
  const open = await read($, expanded)
  const columns = e.props.bodyColumns

  if (s.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor wrap="wrap">
          No steps pinned. When Claude gives you a procedure to follow, it is pinned here; or run /steps pin to pin the
          last numbered list it wrote.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {s.map((p, n) => {
        const isTop = n === 0
        const isOpen = isTop || open === p.id
        const i = currentIndex(p)
        return (
          <Box key={p.id} flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text bold color={isTop ? 'claude' : undefined} dimColor={!isTop}>
                {isTop ? '▶' : '⏸'} {clip(p.title, Math.max(10, columns - 30))}
              </Text>
              <Text dimColor>
                {progressBar(p)} {isFinished(p) ? 'done' : `${i + 1}/${p.steps.length}`}
              </Text>
              {!isTop && <Button key={`${p.id}-resume`} label="Resume" onPress={() => change($, x => resume(x, p.id))} />}
              {!isTop && (
                <Button
                  key={`${p.id}-toggle`}
                  label={isOpen ? 'Hide' : 'Show'}
                  onPress={() => update($, expanded, v => (v === p.id ? null : p.id))}
                />
              )}
              <Button key={`${p.id}-drop`} label="Drop" onPress={() => change($, x => drop(x, p.id))} />
            </Box>
            {isOpen && <Box flexDirection="column" paddingLeft={1}>{stepRows($, els, p, isTop, columns)}</Box>}
          </Box>
        )
      })}
      <Box flexDirection="row" columnGap={1}>
        <Button key="clear" label="Clear all" onPress={() => change($, () => [])} />
      </Box>
    </Box>
  )
}

// ── commands ──

async function runCommand($: EngineInterface, arg: string): Promise<string> {
  if (arg === 'pin') {
    const found = parseBlocks(lastAnswer)
    const list = found.length > 0 ? found : [parseLastList(lastAnswer)].filter((x): x is Parsed => x !== null)
    if (list.length === 0) return 'No steps found in the last answer.'
    await pinAll($, list)
    return `Pinned: ${list.map(l => l.title).join(', ')}.`
  }
  if (arg === 'clear') {
    await change($, () => [])
    return 'All pinned steps cleared.'
  }
  if (arg === 'done' || arg === 'next') {
    const t = await top($)
    if (!t) return 'No steps pinned.'
    if (arg === 'next') {
      await continueNext($)
      return `Step ${t.i + 1} done.`
    }
    await setStatus($, t.p.id, t.i, 'done')
    return `Step ${t.i + 1} of "${t.p.title}" done.`
  }
  await openPane($)
  return 'Pinned steps pane opened.'
}

export const register: Register = (on, opts) => {
  options = opts

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'steps',
      description: 'Pinned steps: open the pane, pin the last list, or mark the current step done',
      argumentHint: '[pin|done|next|clear]',
    })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'steps' }, async ($, e) => ({ text: await runCommand($, e.args.trim().toLowerCase()) }))

  // Tells the model how to write a procedure so it gets pinned.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (options.autoPin === false) return result
    return { sections: [...result.sections, { id: 'pinned-steps:instructions', text: INSTRUCTIONS, scope: 'session' as const }] }
  })

  // Tells the model where the person is, so "let's continue" needs no explaining.
  on('prompt.submit', async ($, e, next) => {
    const note = progressNote(await read($, stack))
    return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
  }).catch(($, e, next) => next(e))

  // Pins the ```steps blocks of the main agent's answers as they arrive.
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    if (e.door !== 'response' || e.agentId !== undefined || e.message.type !== 'assistant') return result
    const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
    if (text.trim() === '') return result
    lastAnswer = text
    try {
      const found = options.autoPin === false ? [] : parseBlocks(text)
      if (found.length > 0) await pinAll($, found)
    } catch {
      // A procedure that failed to pin must not cost the conversation its row.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Draw above whatever the plugins below draw, rather than instead of it.
    const below = await next(e)
    if (e.props.hasSurvey) return below
    return renderBand($, e, below)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
