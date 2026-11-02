import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prod-guard',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}
const PANE = {
  plugin: 'prod-guard',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'prod-guard',
  props: { title: 'Production commands', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
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

test('what the rules refuse stays refused', OPTIONS, async ($, on) => {
  on('tool.check', () => ({ decision: 'deny' as const, reason: 'a rule' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'default\n', stderr: '' } }))
  on('clock.now', () => ({ value: 1000 }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ssh 10.0.0.1 reboot' } })
  expect(r.reason).toBe('a rule')
})

test('the band shows while a command runs, and says what was refused', OPTIONS, async ($, on) => {
  let during: unknown
  let refuse = false
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1000 }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'default\n', stderr: '' } }))
  on('tool.call', async () => {
    const band = await $.ui.mount(BAND)
    during = await band.find({ key: 'clear' })
    await band.unmount()
    return refuse ? { deny: 'no' } : { result: {} }
  })
  await $.tool.call({ tool: 'Bash', command: 'ssh 10.0.0.1 uptime' })
  expect(during).toBeDefined()

  let band = await $.ui.mount(BAND)
  expect(await band.find({ text: /10\.0\.0\.1 · 1 done/ })).toBeDefined()
  await band.press({ key: 'clear' })
  await band.unmount()

  refuse = true
  const refused = await $.tool.call({ tool: 'Bash', command: 'ssh 10.0.0.1 reboot' }).catch((e: unknown) => e)
  expect(refused).toBeDefined()
  band = await $.ui.mount(BAND)
  expect(await band.find({ text: /10\.0\.0\.1 · 1 refused/ })).toBeDefined()
  await band.unmount()
})

test('the commands can be listed, newest first', OPTIONS, async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'default\n', stderr: '' } }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'ssh 10.0.0.1 uptime' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: './deploy.sh' }).catch(() => undefined)

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: /ssh 10\.0\.0\.1 uptime/ })).toBeDefined()
  expect(await pane.find({ text: /read-only/ })).toBeDefined()
  expect(await pane.find({ text: /^ls$/ })).toBeUndefined()
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  await band.press({ key: 'details' })
  await band.press({ key: 'clear' })
  await band.unmount()
  const empty = await $.ui.mount(PANE)
  expect(await empty.find({ text: /No commands/ })).toBeDefined()
  await empty.unmount()
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
  expect(await band.find({ text: /10\.0\.0\.1 · 1 done/ })).toBeDefined()
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
