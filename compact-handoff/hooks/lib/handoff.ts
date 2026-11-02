// Pure logic: nothing here talks to the engine.

export type GitSnapshot = {
  branch?: string
  head?: string
  changedFiles?: number
  unpushed?: number
}

const CHECKLIST = `This is a working handoff: whoever reads the summary must continue without asking the person to re-explain anything. Write the summary in the language of the conversation and keep, as exactly as you can:
1. The goal and the person's latest request, in their words.
2. The plan or spec being followed (file paths), the current step, and what is finished and what is pending.
3. Decisions taken and why, and every constraint or correction the person gave.
4. Branch, worktree, uncommitted work and anything not pushed.
5. Manual or smoke checks: which the person confirmed, which failed, which are still pending.
6. Work still running (background commands, subagents, pipelines, deployments) and how to check on it.
7. The very next concrete action.`

// Files that say where the work stands.
const PLAN_NAME =
  '(?:docs/superpowers/(?:plans|specs)/[\\w.-]+\\.md|STATUS\\.md|DECISIONS\\.md|SPEC\\.md|ARCHITECTURE\\.md|(?:[\\w-]*[_-])?PLANS?(?:[_-][\\w-]*)?\\.md)'
const PLAN_FILE = new RegExp(`(?:^|/)${PLAN_NAME}$`)
const PLAN_IN_TEXT = new RegExp(`(?<![\\w.~/-])(?:~|\\.{1,2})?/?(?:[\\w.-]+/)*${PLAN_NAME}(?![\\w-]|\\.\\w)`, 'g')

// A tool's path, taken whole: it may hold spaces.
export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path)
}

// Paths mentioned in a shell command.
export function planPaths(text: string): string[] {
  return [...new Set(text.match(PLAN_IN_TEXT) ?? [])]
}

// Most recent last, at most `max`, each path once.
export function rememberPaths(known: readonly string[], seen: readonly string[], max = 8): string[] {
  const kept = known.filter(p => !seen.includes(p))
  return [...kept, ...seen].slice(-max)
}

export function buildInstructions(existing: string | undefined, git: GitSnapshot, files: readonly string[]): string {
  const facts: string[] = []
  if (git.branch) facts.push(`- Branch: ${git.branch}`)
  if (git.head) facts.push(`- Last commit: ${git.head}`)
  if (git.changedFiles !== undefined) facts.push(`- Files changed and not committed: ${git.changedFiles}`)
  if (git.unpushed !== undefined) facts.push(`- Commits not pushed: ${git.unpushed}`)
  if (files.length > 0) facts.push(`- Plan and status files used in this session: ${files.join(', ')}`)
  const parts = [existing?.trim(), CHECKLIST]
  if (facts.length > 0) parts.push(`Facts measured just now; copy them into the summary:\n${facts.join('\n')}`)
  return parts.filter(Boolean).join('\n\n')
}

export function handoffLimit(threshold: number, window: number): number {
  return Math.min(threshold, Math.round(window * 0.7))
}

export function shouldWarn(tokens: number, window: number, threshold: number, snoozedUntil: number | null): boolean {
  if (tokens < handoffLimit(threshold, window)) return false
  return snoozedUntil === null || tokens >= snoozedUntil
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}
