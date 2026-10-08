import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T10:00:00Z')

const usage = (percent: number) => ({
  startedAt: NOW - 22 * 60000,
  context: {
    tokens: 150000,
    window: 200000,
    percent,
    breakdown: {
      categories: [
        { name: 'Messages', tokens: 120000, color: 'cyan', isDeferred: false, kind: 'used' as const },
        { name: 'System prompt', tokens: 30000, color: 'gray', isDeferred: false, kind: 'used' as const },
        { name: 'Free', tokens: 50000, color: 'gray', isDeferred: false, kind: 'free' as const },
      ],
      totalTokens: 150000, maxTokens: 200000, rawMaxTokens: 200000, autocompactSource: 'model-default' as const,
      percentage: percent, gridRows: [], model: 'claude-opus-5-5', memoryFiles: [], mcpTools: [],
      agents: [], isAutoCompactEnabled: true, autoCompactThreshold: 184000, apiUsage: null,
    },
  },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 28, resetsAt: '2026-10-06T11:56:00Z' },
    { kind: 'seven_day', percentUsed: 38, resetsAt: '2026-10-09T09:00:00Z' },
  ],
  cost: { usd: 1.5 },
})

const GIT: Record<string, string> = {
  status: '## main...origin/main [ahead 2]\n M src/auth.ts\n',
  diff: '47\t12\tsrc/auth.ts\n',
  log: 'abc1234 feat(auth): refresh token rotation\ndef5678 chore: deps\n',
  'rev-parse': '/repo/my-app\n/repo/my-app/.git\n/repo/my-app/.git\n',
}

const BAND = (surface: 'terminal' | 'desktop') => ({
  plugin: 'claudebar-mod',
  surface,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 }, view: {},
  },
})

const PANE = (surface: 'terminal' | 'desktop') => ({
  plugin: 'claudebar-mod',
  surface,
  component: 'Pane' as const,
  requestId: 'claudebar',
  props: {
    title: 'claudebar', isFocused: false, bodyColumns: 70, placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
})

test('band parity, buttons and pane', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let ctx = 88
  const opened: string[] = []
  let compactions = 0

  on('session.usage', () => ({ value: usage(ctx) }))
  on('session.cwd', () => ({ value: '/repo/my-app' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: GIT[e.argv[3] ?? ''] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  let isPlaced = true
  let isShown = true
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: '110 columns, 90 wide' } }
  })
  on('ui.panes', () => ({
    value: [{ id: 'claudebar', title: 'claudebar', isShown, isFocused: false, isPlaced }],
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.compact', () => {
    compactions += 1
    return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { ok: true } }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/repo/my-app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/repo/my-app/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/my-app/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/my-app/a.ts', old_string: 'a', new_string: 'a\nb\nc' })
  await $.turn.complete({
    answer: 'hecho', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 2000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 900 },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount(BAND(surface))
    // A dim rule separates the band from the conversation.
    expect(await band.find({ text: '─'.repeat(100) })).toBeDefined()
    // Line 1: git
    expect(await band.find({ text: /my-app/ })).toBeDefined()
    expect(await band.find({ text: /main mod:1 ahead:2/ })).toBeDefined()
    expect(await band.find({ text: /refresh token rotation/ })).toBeDefined()
    // Line 2: model, context and the compact button
    expect(await band.find({ text: 'Opus 5.5' })).toBeDefined()
    expect(await band.find({ text: /88%/ })).toBeDefined()
    expect(await band.find({ key: 'compact' })).toBeDefined()
    // Line 3: rate limits with countdown
    expect(await band.find({ text: /\(1h 56m\)/ })).toBeDefined()
    // Line 4: duration, cache, lines edited and cost
    expect(await band.find({ text: /22m 0s/ })).toBeDefined()
    expect(await band.find({ text: /\$1\.50/ })).toBeDefined()
    expect(await band.find({ text: '+3' })).toBeDefined()
    // Line 5: tools
    expect(await band.find({ text: /Read×2 Edit×1/ })).toBeDefined()

    // Compact from the band
    const before = compactions
    await band.press({ key: 'compact' })
    expect(compactions).toBe(before + 1)

    // Open the pane on the context view
    await band.press({ key: 'open-context' })
    expect(opened).toContain('claudebar')
    const pane = await $.ui.mount(PANE(surface))
    expect(await pane.find({ text: /Messages/ })).toBeDefined()
    expect(await pane.find({ text: /Autocompact at 184kt \(92%\)/ })).toBeDefined()
    expect(await pane.find({ text: /Free/ })).toBeUndefined()

    // Switch tabs: git, tools, agents and history
    await pane.press({ key: 'tab-git' })
    expect(await pane.find({ text: /src\/auth\.ts/ })).toBeDefined()
    expect(await pane.find({ text: /abc1234/ })).toBeDefined()
    await pane.press({ key: 'tab-tools' })
    expect(await pane.find({ text: /Main agent/ })).toBeDefined()
    await pane.press({ key: 'tab-agents' })
    expect(await pane.find({ key: 'pick-main' })).toBeDefined()
    expect(await pane.find({ text: '  ▗▄▄█▄▄▖  ' })).toBeDefined()
    await pane.press({ key: 'tab-history' })
    expect(await pane.find({ text: /1 session ·/ })).toBeDefined()
    expect(await pane.find({ text: /tokens/ })).toBeDefined()

    await pane.unmount()
    await band.unmount()
  }

  // In a narrow pane (38 columns, like the dock) the context and history views
  // still draw.
  for (const v of ['tab-context', 'tab-history'] as const) {
    const narrow = await $.ui.mount({ ...PANE('terminal'), props: { ...PANE('terminal').props, bodyColumns: 38 } })
    await narrow.press({ key: v })
    expect(await narrow.find({ text: /Messages|tokens/ })).toBeDefined()
    await narrow.unmount()
  }

  // Below 30% context there is no compact hint.
  ctx = 20
  await clock.advance(15000)
  const quiet = await $.ui.mount(BAND('terminal'))
  expect(await quiet.find({ key: 'compact' })).toBeUndefined()
  await quiet.unmount()

  // A pane that cannot be shown, or sits behind another, raises a toast.
  const band = await $.ui.mount(BAND('terminal'))
  isPlaced = false
  await band.press({ key: 'open-git' })
  expect(toasts.some(t => t.includes('110 columns, 90 wide'))).toBe(true)
  isPlaced = true
  isShown = false
  await band.press({ key: 'open-git' })
  expect(toasts.some(t => t.includes('tab behind another pane'))).toBe(true)
  await band.unmount()

  // At 88% the context alert fires, once.
  expect(toasts.filter(t => t.startsWith('Context at 88%')).length).toBe(1)
})

test('options hide lines', { options: { showTools: false, showLimits: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage(40) }))
  on('session.cwd', () => ({ value: '/tmp/x' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.id', () => ({ value: 'session-2' }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true } }))

  await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x/a' })

  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ text: /Tools:/ })).toBeUndefined()
  expect(await band.find({ text: /^5h/ })).toBeUndefined()
  expect(await band.find({ text: 'Sonnet 5.5' })).toBeDefined()
  // Outside a repository: the directory alone, no branch and no git button.
  expect(await band.find({ text: 'x' })).toBeDefined()
  expect(await band.find({ key: 'open-git' })).toBeUndefined()
  // The separator is on by default.
  expect(await band.find({ text: /^─+$/ })).toBeDefined()
  await band.unmount()
})

test('the separator can be turned off', { options: { showSeparator: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage(40) }))
  on('session.cwd', () => ({ value: '/tmp/x' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.id', () => ({ value: 'session-3' }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ text: 'Sonnet 5.5' })).toBeDefined()
  expect(await band.find({ text: /^─+$/ })).toBeUndefined()
  await band.unmount()
})
