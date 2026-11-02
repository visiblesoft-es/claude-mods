import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prod-guard',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}
const OPTIONS = { options: { hosts: '10.0.0.1', dockerContexts: 'prod-ctx', patterns: 'deploy\\.sh', bandMinutes: 30 } }

test('writes are refused where nobody can be asked; reads and other commands pass', OPTIONS, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'default\n', stderr: '' } }))
  on('clock.now', () => ({ value: 1000 }))
  const check = (command: string) => $.tool.check({ tool: 'Bash', input: { command } })
  expect((await check('ssh 10.0.0.1 rm -rf /x')).decision).toBe('deny')
  expect((await check('./deploy.sh')).decision).toBe('deny')
  expect((await check('ssh 10.0.0.1 uptime')).decision).toBe('allow')
  expect((await check('ls')).decision).toBe('allow')
})

test('the docker context in use is read from docker', OPTIONS, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'prod-ctx\n', stderr: '' } }))
  on('clock.now', () => ({ value: 1000 }))
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'docker compose up -d' } })).decision).toBe('deny')
})

test('a missing docker counts as no context', OPTIONS, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('process.run', () => { throw new Error('ENOENT') })
  on('clock.now', () => ({ value: 1000 }))
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'docker ps' } })).decision).toBe('allow')
})

test('the band shows what ran, unlocks, locks and clears', OPTIONS, async ($, on) => {
  let now = 1_000_000
  const toasts: string[] = []
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('clock.now', () => ({ value: now }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'default\n', stderr: '' } }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  let band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'unlock' })).toBeUndefined()
  await band.unmount()

  await $.tool.call({ tool: 'Bash', command: 'ssh 10.0.0.1 uptime' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(toasts).toEqual(['This session is touching production: 10.0.0.1'])
  band = await $.ui.mount(BAND)
  expect(await band.find({ text: /10\.0\.0\.1 · 1 command · 0 possible writes/ })).toBeDefined()
  expect(await band.find({ text: 'engine' })).toBeDefined()

  const write = () => $.tool.check({ tool: 'Bash', input: { command: 'ssh 10.0.0.1 reboot' } })
  expect((await write()).decision).toBe('deny')
  await band.press({ key: 'unlock' })
  expect((await write()).decision).toBe('allow')
  now += 16 * 60_000
  expect((await write()).decision).toBe('deny')
  now -= 16 * 60_000
  await band.press({ key: 'lock' })
  expect((await write()).decision).toBe('deny')

  await band.press({ key: 'clear' })
  expect(await band.find({ key: 'unlock' })).toBeUndefined()
  await band.unmount()

  await $.tool.call({ tool: 'Bash', command: 'ssh 10.0.0.1 uptime' })
  now += 31 * 60_000
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })
  band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'clear' })).toBeUndefined()
  await band.unmount()
})
