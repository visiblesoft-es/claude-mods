import { describe, expect, test } from 'claude-code/testing'

import { editDelta } from '../hooks/register'
import { bar, cacheRate, compactHint, countdown, duration, modelName, plural, usageColor } from '../hooks/lib/format'
import { parseNumstat, parseStatus } from '../hooks/lib/git'

describe('formatting (same as statusline.sh)', () => {
  test('8-cell bars and traffic light', () => {
    expect(bar(25)).toBe('▓▓░░░░░░')
    expect(bar(0)).toBe('░░░░░░░░')
    expect(bar(100)).toBe('▓▓▓▓▓▓▓▓')
    expect(usageColor(69)).toBe('green')
    expect(usageColor(70)).toBe('yellow')
    expect(usageColor(90)).toBe('red')
  })

  test('model name', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-4-6[1m]')).toBe('Sonnet 4.6 1M')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  test('duration and countdown', () => {
    expect(duration(22 * 60000 + 34000)).toBe('22m 34s')
    expect(duration(68 * 60000)).toBe('1h 8m')
    const now = Date.parse('2026-10-06T10:00:00Z')
    expect(countdown('2026-10-06T11:22:00Z', now)).toBe('1h 22m')
    expect(countdown('2026-10-10T15:00:00Z', now)).toBe('4d 5h')
    expect(countdown(null, now)).toBeNull()
  })

  test('compact hint: same scores', () => {
    expect(compactHint(25, 10, 200)).toBeNull()
    expect(compactHint(55, 90, 10)?.label).toBe('✦ compact?')
    expect(compactHint(74, 90, 10)?.label).toBe('⚡ /compact')
    expect(compactHint(88, 40, 100)?.label).toBe('⚠ COMPACT')
  })

  test('plurals', () => {
    expect(plural(1, 'session')).toBe('1 session')
    expect(plural(3, 'session')).toBe('3 sessions')
  })

  test('cache hit rate', () => {
    expect(cacheRate({ input: 10, cacheRead: 90, cacheCreation: 0 })).toBe(90)
    expect(cacheRate(null)).toBeNull()
  })
})

describe('git', () => {
  test('branch, ahead and files', () => {
    const parsed = parseStatus('## main...origin/main [ahead 2]\n M src/a.ts\n?? b.ts\n')
    expect(parsed.branch).toBe('main')
    expect(parsed.ahead).toBe(2)
    expect(parsed.files).toEqual([{ status: 'M', path: 'src/a.ts' }, { status: '??', path: 'b.ts' }])
  })

  test('numstat skips binaries', () => {
    expect(parseNumstat('10\t2\ta.ts\n-\t-\timg.png\n5\t0\tb.ts\n')).toEqual({ added: 15, removed: 2 })
  })
})

test('lines edited per tool', () => {
  expect(editDelta('Edit', { old_string: 'a\nb', new_string: 'a\nb\nc' })).toEqual({ added: 3, removed: 2 })
  expect(editDelta('Write', { content: 'x\ny' })).toEqual({ added: 2, removed: 0 })
  expect(editDelta('Read', { file_path: 'x' })).toEqual({ added: 0, removed: 0 })
})
