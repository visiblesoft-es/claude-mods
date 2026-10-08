import { expect, test } from 'claude-code/testing'

import { copyTarget, currentIndex, mark, markUpTo, parseBlocks, parseLastList, pin, progressNote, resume, settle } from '../hooks/lib/steps'

const ANSWER = [
  'Do this:',
  '',
  '```steps',
  '# Deploy to staging',
  '1. Pull main and build',
  '2. Run the migration: `dotnet ef database update`',
  '   It takes a minute.',
  '3. Restart the service',
  '```',
  '',
  'Tell me how it goes.',
].join('\n')

test('parses a steps block with a title and details', () => {
  const [p] = parseBlocks(ANSWER)
  expect(p?.title).toBe('Deploy to staging')
  expect(p?.steps.length).toBe(3)
  expect(p?.steps[1]?.detail).toBe('It takes a minute.')
  expect(copyTarget({ ...p!.steps[1]!, status: 'todo' })).toBe('dotnet ef database update')
  expect(copyTarget({ ...p!.steps[0]!, status: 'todo' })).toBe(null)
})

test('ignores other code blocks and ordinary lists', () => {
  expect(parseBlocks('```ts\n1. not steps\n```\n\n1. a\n2. b')).toEqual([])
})

test('a block without a title is called Steps', () => {
  expect(parseBlocks('```steps\n1. a\n2. b\n```')[0]?.title).toBe('Steps')
})

test('/steps pin finds the last numbered list and its title', () => {
  const p = parseLastList('Intro\n\n**Renew the certificate:**\n1. Generate the CSR\n2. Upload it\n\nThen tell me.')
  expect(p?.title).toBe('Renew the certificate')
  expect(p?.steps.map(s => s.text)).toEqual(['Generate the CSR', 'Upload it'])
  expect(parseLastList('No list here')).toBe(null)
})

test('the stack: push, pause, revise, finish and resume', () => {
  const deploy = parseBlocks(ANSWER)[0]!
  let s = pin([], deploy, 'a', 1).stack
  s = markUpTo(s, 'a', 1)
  expect(currentIndex(s[0]!)).toBe(2)

  // A new procedure goes on top and pauses the deploy.
  const cert = { title: 'Renew the certificate', steps: [{ text: 'Generate the CSR' }, { text: 'Upload it' }] }
  s = pin(s, cert, 'b', 2).stack
  expect(s.map(p => p.title)).toEqual(['Renew the certificate', 'Deploy to staging'])
  expect(progressNote(s)).toContain('Paused under it: "Deploy to staging", at step 3/3')

  // Same title: a revision keeps the steps already done.
  const revised = pin(s, { ...deploy, steps: [...deploy.steps, { text: 'Check the health endpoint' }] }, 'c', 3)
  expect(revised.isRevision).toBe(true)
  expect(revised.stack[1]?.steps.length).toBe(4)
  expect(currentIndex(revised.stack[1]!)).toBe(2)

  // Finishing the certificate takes it off and the deploy is back on top.
  s = mark(mark(s, 'b', 0, 'done'), 'b', 1, 'skipped')
  const settled = settle(s)
  expect(settled.finished.map(p => p.title)).toEqual(['Renew the certificate'])
  expect(settled.stack.map(p => p.title)).toEqual(['Deploy to staging'])

  expect(resume(revised.stack, 'a')[0]?.id).toBe('a')
})
