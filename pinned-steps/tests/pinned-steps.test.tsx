import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'pinned-steps',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 }, view: {},
  },
}

const PANE = {
  plugin: 'pinned-steps',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'pinned-steps',
  props: {
    title: 'Pinned steps', isFocused: false, bodyColumns: 60, placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
}

const answer = (text: string) => ({
  message: { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: 'text' as const, text }] },
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
  uuid: `row-${text.length}`,
})

const DEPLOY = '```steps\n# Deploy to staging\n1. Pull main\n2. Run `dotnet ef database update`\n3. Restart the service\n```'
const CERT = '```steps\n# Renew the certificate\n1. Generate the CSR\n2. Upload it\n```'

test('pins, stacks, continues and resumes', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const saved: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  // What the engine draws in the band when no plugin does.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const toasts: string[] = []
  const submitted: string[] = []
  const filled: string[] = []
  const copied: string[] = []
  on('session.cwd', () => ({ value: '/repo/app' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'pinned-steps', title: 'Pinned steps', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  let context: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    context = e.context ?? []
    submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))

  await $.session.start({ cwd: '/repo/app', surface: 'terminal', isInteractive: true })

  // The model learns the format.
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.some(s => s.id === 'pinned-steps:instructions')).toBe(true)

  // Nothing pinned: the band passes.
  const empty = await $.ui.mount(BAND)
  expect(await empty.find({ key: 'done' })).toBeUndefined()
  await empty.unmount()

  // An answer with a steps block pins it.
  await $.session.append(answer(DEPLOY))
  expect(toasts.some(t => t.startsWith('Pinned: Deploy to staging (3 steps)'))).toBe(true)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ text: /Deploy to staging/ })).toBeDefined()
  expect(await band.find({ text: /1\/3/ })).toBeDefined()
  expect(await band.find({ text: /Pull main/ })).toBeDefined()
  // What other plugins draw in the band stays, under the steps.
  expect(await band.find({ text: 'engine' })).toBeDefined()

  // Done moves to step 2, which has a command to copy.
  await band.press({ key: 'done' })
  expect(await band.find({ text: /2\/3/ })).toBeDefined()
  await band.press({ key: 'copy' })
  expect(copied).toEqual(['dotnet ef database update'])

  // The model reads where the person is.
  await $.prompt.submit({ text: 'what was that error?', wait: false, origin: { kind: 'composer' } })
  expect(context.join('\n')).toContain('now on step 2/3')

  // An interruption: a new procedure goes on top and the deploy is paused.
  await $.session.append(answer(CERT))
  expect(await band.find({ text: /Renew the certificate/ })).toBeDefined()
  expect(await band.find({ text: /paused: Deploy to staging · step 2\/3/ })).toBeDefined()

  // Failed starts a prompt; Continue on the last step finishes it and goes back.
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: /Generate the CSR/ })).toBeDefined()
  await pane.press({ key: '1000-2-fail' })
  expect(filled).toEqual(['Step 1 of "Renew the certificate" (Generate the CSR) failed: '])
  expect(await band.find({ text: /✗/ })).toBeDefined()
  await band.press({ key: 'done' })
  await band.press({ key: 'continue' })
  expect(toasts.some(t => t.includes('Finished: Renew the certificate') && t.includes('Back to "Deploy to staging", step 2/3'))).toBe(true)
  expect(submitted.at(-1)).toContain('Let\'s go back to "Deploy to staging", step 2')
  expect(await band.find({ text: /paused/ })).toBeUndefined()

  // The stack is stored per project.
  expect((saved['stack:/repo/app'] as unknown[]).length).toBe(1)

  // /steps pin on an answer with an ordinary list.
  await $.session.append(answer('Try this:\n1. Clear the cache\n2. Reload'))
  const pinned = await $.command.run({ command: 'steps', args: 'pin', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect('text' in pinned && pinned.text).toContain('Try this')

  await pane.unmount()
  await band.unmount()
})
