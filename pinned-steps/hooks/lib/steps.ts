import type { Procedure, Step, StepStatus } from '../../types'

// Pure functions: parsing procedures out of the model's text, and the stack of
// procedures (index 0 is the one being followed, the rest are paused under it).

export const MAX_STACK = 6

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*steps\b[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*$/gim
const NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/

export type Parsed = { title: string; steps: { text: string; detail?: string }[] }

/** The ```steps blocks of a text, in order. */
export function parseBlocks(text: string): Parsed[] {
  const found: Parsed[] = []
  for (const m of text.matchAll(FENCE)) {
    const parsed = parseBody(m[2] ?? '')
    if (parsed.steps.length > 0) found.push(parsed)
  }
  return found
}

function parseBody(body: string): Parsed {
  let title = ''
  const steps: Parsed['steps'] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') continue
    const heading = /^\s*#+\s+(.+)$/.exec(line)
    if (heading && steps.length === 0 && title === '') {
      title = heading[1]!.trim()
      continue
    }
    const item = NUMBERED.exec(line)
    if (item) {
      steps.push({ text: item[2]!.trim() })
      continue
    }
    // Any other line belongs to the step above it.
    const last = steps[steps.length - 1]
    if (last) last.detail = last.detail ? `${last.detail}\n${line.trim()}` : line.trim()
  }
  return { title: title || 'Steps', steps }
}

/**
 * The last numbered list of a plain text (for `/steps pin` on an answer that
 * had no ```steps block), titled by the line just before it when there is one.
 */
export function parseLastList(text: string): Parsed | null {
  const lines = text.split('\n')
  let end = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (NUMBERED.test(lines[i]!)) {
      end = i
      break
    }
  }
  if (end < 0) return null
  let start = end
  // Walk up over numbered lines, their indented continuations and blank lines between them.
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i]!
    if (NUMBERED.test(line)) start = i
    else if (line.trim() === '' || /^\s{2,}\S/.test(line)) continue
    else break
  }
  const body = lines.slice(start, end + 1).join('\n')
  const parsed = parseBody(body)
  if (parsed.steps.length < 2) return null
  const before = lines.slice(0, start).reverse().find(l => l.trim() !== '')
  const title = before ? cleanTitle(before) : ''
  return { ...parsed, title: title || 'Steps' }
}

function cleanTitle(line: string): string {
  return line
    .replace(/^\s*#+\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .slice(0, 80)
}

/** What a step's Copy button copies: its first `code` span, else nothing. */
export function copyTarget(step: Step): string | null {
  for (const source of [step.text, step.detail ?? '']) {
    const m = /`([^`\n]+)`/.exec(source)
    if (m) return m[1]!
  }
  return null
}

/** The step being followed: the first one neither done nor skipped. */
export function currentIndex(p: Procedure): number {
  return p.steps.findIndex(s => s.status !== 'done' && s.status !== 'skipped')
}

export function isFinished(p: Procedure): boolean {
  return currentIndex(p) < 0
}

export function doneCount(p: Procedure): number {
  return p.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Adds a parsed procedure to the stack. One with the title of a procedure
 * already there revises it in place, keeping the status of every step whose
 * text did not change; any other goes on top, pausing the one under it.
 */
export function pin(stack: Procedure[], parsed: Parsed, id: string, now: number): { stack: Procedure[]; isRevision: boolean } {
  const at = stack.findIndex(p => sameTitle(p.title, parsed.title))
  if (at >= 0) {
    const old = stack[at]!
    const steps = parsed.steps.map((s, i): Step => {
      const prev = old.steps.find(o => o.text === s.text) ?? (old.steps[i]?.text === s.text ? old.steps[i] : undefined)
      return { ...s, status: prev?.status ?? 'todo' }
    })
    const revised = { ...old, title: parsed.title, steps }
    return { stack: stack.map((p, i) => (i === at ? revised : p)), isRevision: true }
  }
  const fresh: Procedure = {
    id,
    title: parsed.title,
    createdAt: now,
    steps: parsed.steps.map(s => ({ ...s, status: 'todo' as StepStatus })),
  }
  return { stack: [fresh, ...stack].slice(0, MAX_STACK), isRevision: false }
}

/** Sets one step's status; a finished procedure leaves the stack. */
export function mark(stack: Procedure[], procId: string, index: number, status: StepStatus): Procedure[] {
  return stack.map(p =>
    p.id !== procId ? p : { ...p, steps: p.steps.map((s, i) => (i === index ? { ...s, status } : s)) },
  )
}

/** Marks the current step done and the steps before it too. */
export function markUpTo(stack: Procedure[], procId: string, index: number): Procedure[] {
  return stack.map(p =>
    p.id !== procId
      ? p
      : { ...p, steps: p.steps.map((s, i) => (i <= index && s.status !== 'skipped' ? { ...s, status: 'done' } : s)) },
  )
}

/** Brings a paused procedure to the top. */
export function resume(stack: Procedure[], procId: string): Procedure[] {
  const p = stack.find(x => x.id === procId)
  return p ? [p, ...stack.filter(x => x.id !== procId)] : stack
}

export function drop(stack: Procedure[], procId: string): Procedure[] {
  return stack.filter(p => p.id !== procId)
}

/** Splits off the finished procedures, keeping the others in order. */
export function settle(stack: Procedure[]): { stack: Procedure[]; finished: Procedure[] } {
  return { stack: stack.filter(p => !isFinished(p)), finished: stack.filter(isFinished) }
}

const where = (p: Procedure) => {
  const i = currentIndex(p)
  return i < 0 ? 'finished' : `step ${i + 1}/${p.steps.length} ("${p.steps[i]!.text}")`
}

/** The note the model reads beside each prompt while procedures are pinned. */
export function progressNote(stack: Procedure[]): string | null {
  const top = stack[0]
  if (!top) return null
  const i = currentIndex(top)
  const failed = i >= 0 && top.steps[i]!.status === 'failed' ? ' The user marked that step as failed.' : ''
  const lines = [
    `[pinned-steps] The user is following the pinned procedure "${top.title}", now on ${where(top)}; ${doneCount(top)} of ${top.steps.length} steps are done.${failed}`,
  ]
  for (const p of stack.slice(1)) lines.push(`Paused under it: "${p.title}", at ${where(p)}.`)
  lines.push('If the user asks to continue, pick up from the current step. Do not mention this note.')
  return lines.join('\n')
}

/** The instructions the model gets in its system prompt. */
export const INSTRUCTIONS = [
  '# Pinned steps',
  'When you give the user a procedure they will carry out themselves, step by step (commands to run, settings to change, things to check), write its steps in a fenced code block whose info string is `steps`, instead of an ordinary numbered list: an optional first line `# Title`, then one line per step, `1. ...`, short and imperative, with any command in backticks. Lines under a step that are not numbered are its details. The pinned-steps plugin pins the block above the prompt, so the user can follow it while the conversation moves on to other things.',
  'Use it only for procedures the user performs, not for your own plan of work or for ordinary lists. To revise a pinned procedure, write the block again with the same title; a new title pins a new procedure on top of the current one, and the current one resumes when the new one is finished.',
].join('\n\n')
