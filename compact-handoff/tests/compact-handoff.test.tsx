import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'compact-handoff',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}

const SUMMARY = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

test('the band offers a handoff past the threshold, and every compaction carries it', async ($, on) => {
  let tokens = 120_000
  let told: string | undefined
  const toasts: string[] = []
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'handoff' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'feat/x\n', stderr: '' } }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))
  on('session.compact', (_$, e) => { told = e.instructions; return { messages: SUMMARY, tokensBefore: tokens, tokensAfter: 30_000 } })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sed -n 1,9p docs/PLAN_X.md' })

  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })
  let band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'handoff' })).toBeUndefined()
  expect(await band.find({ text: 'engine' })).toBeDefined()
  await band.unmount()

  tokens = 320_000
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })
  band = await $.ui.mount(BAND)
  expect(await band.find({ text: /Context 320k/ })).toBeDefined()
  expect(await band.find({ text: 'engine' })).toBeDefined()

  await band.press({ key: 'snooze' })
  expect(await band.find({ key: 'handoff' })).toBeUndefined()
  tokens = 420_000
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })
  expect(await band.find({ key: 'handoff' })).toBeDefined()

  await band.press({ key: 'handoff' })
  expect(told).toContain('The very next concrete action')
  expect(told).toContain('Branch: feat/x')
  expect(told).toContain('docs/PLAN_X.md')
  expect(toasts).toContain('Handoff: 420k → 30k')
  expect(await band.find({ key: 'handoff' })).toBeUndefined()
  await band.unmount()
})

test('a compaction started elsewhere carries the handoff; a subagent keeps its own', async ($, on) => {
  let told: string | undefined
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.compact', (_$, e) => { told = e.instructions; return { messages: SUMMARY } })

  await $.session.compact({ instructions: 'keep the SQL', messages: SUMMARY } as never)
  expect(told?.startsWith('keep the SQL')).toBe(true)
  expect(told).toContain('The very next concrete action')

  await $.session.compact({ agentId: 'sub-1', messages: SUMMARY } as never)
  expect(told).toBeUndefined()
})

test('a compaction that cannot run now is said, and the button comes back', async ($, on) => {
  const toasts: string[] = []
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => { throw new Error('a turn is running') })
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })

  const band = await $.ui.mount(BAND)
  await band.press({ key: 'handoff' })
  expect(toasts).toContain('Could not compact now. Wait for the turn to end and try again.')
  expect(await band.find({ key: 'handoff' })).toBeDefined()
  await band.unmount()
})
