import type { GitFile, GitInfo } from '../../types'

export function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

// `## main...origin/main [ahead 2, behind 1]` → branch and unpushed commits.
export function parseBranch(line: string): { branch: string | null; ahead: number } {
  const body = line.replace(/^## /, '')
  const ahead = Number(/ahead (\d+)/.exec(body)?.[1] ?? 0)
  if (body.startsWith('No commits yet on ')) return { branch: body.slice(18).split('...')[0] ?? null, ahead }
  if (body.startsWith('HEAD (no branch)')) return { branch: 'HEAD', ahead }
  return { branch: body.split('...')[0]?.split(' ')[0] ?? null, ahead }
}

export function parseStatus(stdout: string): { branch: string | null; ahead: number; files: GitFile[] } {
  const lines = stdout.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? parseBranch(lines[0]) : { branch: null, ahead: 0 }
  const files = lines
    .filter(l => !l.startsWith('## '))
    .map(l => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }))
  return { ...head, files }
}

export function parseNumstat(stdout: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of stdout.split('\n')) {
    const [a, r] = line.split('\t')
    if (a && a !== '-') added += Number(a) || 0
    if (r && r !== '-') removed += Number(r) || 0
  }
  return { added, removed }
}
