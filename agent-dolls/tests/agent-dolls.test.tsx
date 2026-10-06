import { expect, test } from 'claude-code/testing'

const AGENTS = [
  { id: 'a1', type: 'Explore', description: 'find endpoints', status: 'running' as const },
  { id: 'a2', type: 'general-purpose', description: 'migrate tests', status: 'completed' as const, parentId: 'a1' },
]

const MESSAGES = [
  { role: 'user' as const, text: 'Find the endpoints', toolUses: [] },
  {
    role: 'assistant' as const,
    text: 'Found 14 endpoints',
    toolUses: [{ tool_use_id: 't1', tool: 'Grep', input: { pattern: 'MapGet' } }],
  },
]

const paneProps = (title: string, agentId?: string) => ({
  title,
  isFocused: false,
  bodyColumns: 50,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: agentId ? { agentId } : {},
})

test('one doll per agent, and its conversation on press', async ($, on) => {
  const opened: string[] = []
  on('agent.list', () => ({ value: AGENTS }))
  on('session.messages', (_$, e) =>
    ({ value: e.agentId === 'a1' ? MESSAGES : { deny: 'no transcript' } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    opened.length = 0
    await $.command.run({
      command: 'dolls',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })
    expect(opened).toContain('agent-dolls')

    const list = await $.ui.mount({
      plugin: 'agent-dolls', surface, component: 'Pane', requestId: 'agent-dolls',
      props: paneProps('Agents', 'a2'),
    })
    expect(await list.find({ key: 'pick-main' })).toBeDefined()
    expect(await list.find({ key: 'pick-a1' })).toBeDefined()
    expect(await list.find({ key: 'pick-a2' })).toBeDefined()
    expect(await list.find({ text: /on screen/ })).toBeDefined()
    // Full robots while no conversation is shown: an Explore one, cheering when finished.
    expect(await list.find({ text: '  ▗▄▄█▄▄▖  ' })).toBeDefined()
    expect(await list.find({ text: '▝▘▐ ^ ^ ▌▝▘' })).toBeDefined()

    // The conversation shows in the same pane, without opening another.
    await list.press({ key: 'pick-a1' })
    expect(opened).not.toContain('agent-dolls-detail')
    expect(await list.find({ text: /Found 14 endpoints/ })).toBeDefined()
    expect(await list.find({ text: /Grep MapGet/ })).toBeDefined()
    expect(await list.find({ key: 'back' })).toBeDefined()
    // With the conversation open, the robots shrink to one line.
    expect(await list.find({ text: '  ▗▄▄█▄▄▖  ' })).toBeUndefined()

    // Pressing the same robot again hides it.
    await list.press({ key: 'pick-a1' })
    expect(await list.find({ text: /Found 14 endpoints/ })).toBeUndefined()

    await list.press({ key: 'pick-a1' })
    await list.press({ key: 'back' })
    expect(await list.find({ key: 'back' })).toBeUndefined()
    await list.unmount()
  }
})
