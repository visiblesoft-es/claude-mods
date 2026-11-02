import { expect, test } from 'claude-code/testing'

import { buildInstructions, handoffLimit, isPlanFile, planPaths, rememberPaths, shouldWarn } from '../hooks/lib/handoff'

test('finds plan and status files in a path or a command', () => {
  expect(planPaths('docs/superpowers/plans/2026-10-01-foo.md')).toEqual(['docs/superpowers/plans/2026-10-01-foo.md'])
  expect(planPaths('sed -n 1,40p docs/PLAN_IMPROVEMENTS.md && cat STATUS.md')).toEqual(['docs/PLAN_IMPROVEMENTS.md', 'STATUS.md'])
  expect(planPaths('dotnet test && cat README.md')).toEqual([])
})

test('keeps paths whole and leaves look-alikes out', () => {
  expect(planPaths('cat /Users/jl/repo/STATUS.md')).toEqual(['/Users/jl/repo/STATUS.md'])
  expect(planPaths('cat ~/repo/docs/PLAN.md ./SPEC.md')).toEqual(['~/repo/docs/PLAN.md', './SPEC.md'])
  expect(planPaths('cat /a/IMPLEMENTATION_PLAN.md')).toEqual(['/a/IMPLEMENTATION_PLAN.md'])
  for (const other of ['docs/PROJECT_STATUS.md', 'STATUS.mdx', '/a/EXPLANATION.md']) expect(planPaths(other)).toEqual([])
  expect(isPlanFile('/My Docs/PLAN.md')).toBe(true)
  expect(isPlanFile('/r/docs/superpowers/specs/x.md')).toBe(true)
  for (const other of ['/a/PROJECT_STATUS.md', '/a/STATUS.mdx', '/a/EXPLANATION.md', '/a/README.md']) expect(isPlanFile(other)).toBe(false)
})

test('remembers the latest paths once each', () => {
  expect(rememberPaths(['a', 'b'], ['a'])).toEqual(['b', 'a'])
  expect(rememberPaths(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
})

test('keeps what the person asked, the checklist and the facts', () => {
  const text = buildInstructions('keep the SQL', { branch: 'feat/x', changedFiles: 2, unpushed: 0 }, ['STATUS.md'])
  expect(text.startsWith('keep the SQL')).toBe(true)
  expect(text).toContain('The very next concrete action')
  expect(text).toContain('Branch: feat/x')
  expect(text).toContain('not committed: 2')
  expect(text).toContain('not pushed: 0')
  expect(text).toContain('STATUS.md')
  expect(buildInstructions(undefined, {}, [])).not.toContain('Facts measured')
})

test('warns past the limit, respecting a small window and a snooze', () => {
  expect(handoffLimit(300_000, 1_000_000)).toBe(300_000)
  expect(handoffLimit(300_000, 200_000)).toBe(140_000)
  expect(shouldWarn(299_000, 1_000_000, 300_000, null)).toBe(false)
  expect(shouldWarn(300_000, 1_000_000, 300_000, null)).toBe(true)
  expect(shouldWarn(320_000, 1_000_000, 300_000, 400_000)).toBe(false)
  expect(shouldWarn(400_000, 1_000_000, 300_000, 400_000)).toBe(true)
})
